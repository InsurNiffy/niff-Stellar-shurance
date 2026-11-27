use axum::{
    extract::{Query, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

/// Operation types the transaction history UI actually renders.
const RELEVANT_OPERATION_TYPES: &[&str] = &[
    "payment",
    "create_account",
    "path_payment_strict_send",
    "path_payment_strict_receive",
    "account_merge",
    "manage_sell_offer",
    "manage_buy_offer",
    "change_trust",
];

/// Fields returned by Horizon that the UI does not need (or must not see).
const STRIPPED_FIELDS: &[&str] = &[
    "paging_token",
    "source_account_sequence",
    "source_account_muxed",
    "source_account_muxed_id",
    "fee_account",
    "fee_account_muxed",
    "fee_account_muxed_id",
    "fee_charged",
    "max_fee",
    "inner_transaction_hash",
    "signatures",
    "_links",
];

const RATE_LIMIT_MAX_REQUESTS: u32 = 30;
const RATE_LIMIT_WINDOW: Duration = Duration::from_secs(60);

#[derive(Clone)]
pub struct HorizonProxyState {
    pub horizon_url: String,
    pub http_client: reqwest::Client,
    rate_limiter: Arc<Mutex<HashMap<String, RateBucket>>>,
}

impl HorizonProxyState {
    pub fn new(horizon_url: String) -> Self {
        Self {
            horizon_url: horizon_url.trim_end_matches('/').to_string(),
            http_client: reqwest::Client::new(),
            rate_limiter: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Returns `Some(retry_after_secs)` when the wallet has exceeded its budget.
    fn check_rate_limit(&self, account: &str) -> Option<u64> {
        let now = Instant::now();
        let mut buckets = match self.rate_limiter.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };

        let bucket = buckets.entry(account.to_string()).or_insert(RateBucket {
            window_start: now,
            count: 0,
        });

        if now.duration_since(bucket.window_start) >= RATE_LIMIT_WINDOW {
            bucket.window_start = now;
            bucket.count = 0;
        }

        if bucket.count >= RATE_LIMIT_MAX_REQUESTS {
            let elapsed = now.duration_since(bucket.window_start);
            let remaining = RATE_LIMIT_WINDOW.saturating_sub(elapsed);
            return Some(remaining.as_secs().max(1));
        }

        bucket.count += 1;
        None
    }
}

struct RateBucket {
    window_start: Instant,
    count: u32,
}

#[derive(Debug, Deserialize)]
pub struct TransactionsQuery {
    pub account: Option<String>,
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    error: String,
}

pub fn router(state: HorizonProxyState) -> Router {
    Router::new()
        .route("/horizon/transactions", get(get_transactions))
        .with_state(state)
}

async fn get_transactions(
    State(state): State<HorizonProxyState>,
    Query(params): Query<TransactionsQuery>,
) -> Response {
    let account = match params.account.as_deref().map(str::trim) {
        Some(account) if !account.is_empty() => account.to_string(),
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ErrorBody {
                    error: "missing required query parameter: account".to_string(),
                }),
            )
                .into_response();
        }
    };

    if !is_valid_account(&account) {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorBody {
                error: "invalid account address".to_string(),
            }),
        )
            .into_response();
    }

    if let Some(retry_after) = state.check_rate_limit(&account) {
        let mut headers = HeaderMap::new();
        if let Ok(value) = HeaderValue::from_str(&retry_after.to_string()) {
            headers.insert("retry-after", value);
        }
        return (
            StatusCode::TOO_MANY_REQUESTS,
            headers,
            Json(ErrorBody {
                error: "rate limit exceeded for this account".to_string(),
            }),
        )
            .into_response();
    }

    let url = format!(
        "{}/accounts/{}/transactions?order=desc&limit=50",
        state.horizon_url, account
    );

    let upstream = match state.http_client.get(&url).send().await {
        Ok(response) => response,
        Err(_) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(ErrorBody {
                    error: "failed to reach horizon".to_string(),
                }),
            )
                .into_response();
        }
    };

    let status = upstream.status();
    if !status.is_success() {
        // Never forward upstream headers or bodies: they may carry credentials.
        return (
            StatusCode::BAD_GATEWAY,
            Json(ErrorBody {
                error: "horizon returned an error".to_string(),
            }),
        )
            .into_response();
    }

    let payload: Value = match upstream.json().await {
        Ok(value) => value,
        Err(_) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(ErrorBody {
                    error: "invalid response from horizon".to_string(),
                }),
            )
                .into_response();
        }
    };

    let records = payload
        .get("_embedded")
        .and_then(|embedded| embedded.get("records"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let filtered: Vec<Value> = records
        .into_iter()
        .filter(|record| is_relevant_operation(record))
        .map(strip_internal_fields)
        .collect();

    Json(json!({ "transactions": filtered })).into_response()
}

fn is_valid_account(account: &str) -> bool {
    account.len() == 56
        && account.starts_with('G')
        && account
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
}

fn is_relevant_operation(record: &Value) -> bool {
    match record.get("type").and_then(Value::as_str) {
        Some(op_type) => RELEVANT_OPERATION_TYPES.contains(&op_type),
        None => false,
    }
}

fn strip_internal_fields(mut record: Value) -> Value {
    if let Some(object) = record.as_object_mut() {
        for field in STRIPPED_FIELDS {
            object.remove(*field);
        }
    }
    record
}
