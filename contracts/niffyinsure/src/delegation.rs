//! Admin role delegation: temporary operator grants with expiry (Issue #585).
//!
//! Allows the admin to grant temporary operator roles with specific permissions
//! and an expiry ledger. Delegated operators can only perform permitted operations.
//!
//! # Enumeration (Issue #1149)
//!
//! `list_active_delegated_scopes` is a **read-only** query that returns the discrete
//! permission scopes currently held by a given operator address. Expired and revoked
//! grants are excluded. Results are paginated (`start_after` skip count + `limit`
//! clamped to `PAGE_SIZE_MAX`) so callers remain safe if permission sets grow.
use soroban_sdk::{contractevent, Address, Env, Vec};

use crate::{
    storage,
    types::{
        ActiveDelegatedScope, DelegatedScopeKind, DelegationPermissions, DelegationRecord,
        PAGE_SIZE_MAX,
    },
    validate::Error,
};

#[contractevent(topics = ["niffyinsure", "delegation_granted"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DelegationGranted {
    #[topic]
    pub operator: Address,
    pub grantor: Address,
    pub expiry_ledger: u32,
    pub permissions: DelegationPermissions,
}

/// Emitted when a still-valid delegation is explicitly revoked before expiry.
///
/// Topics are indexable by both the delegate (`operator`) and the original
/// grantor (`grantor` / delegator). Payload includes the revoked permission
/// scope so off-chain indexers can update delegation state without a storage
/// round-trip.
///
/// Natural expiry (ledger advances past `expiry_ledger` with no revoke call)
/// does **not** emit this event.
#[contractevent(topics = ["niffyinsure", "delegation_revoked"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DelegationRevoked {
    /// Delegate whose authority was revoked.
    #[topic]
    pub operator: Address,
    /// Original grantor / delegator of the revoked authority.
    #[topic]
    pub grantor: Address,
    /// Admin who performed the early revocation.
    pub revoked_by: Address,
    /// Permission scope that was revoked.
    pub permissions: DelegationPermissions,
    pub at_ledger: u32,
}

/// Admin-only: grant a temporary delegation to `operator`.
pub fn grant_delegation(
    env: &Env,
    admin: &Address,
    operator: &Address,
    expiry_ledger: u32,
    permissions: DelegationPermissions,
) -> Result<(), Error> {
    let now = env.ledger().sequence();
    if expiry_ledger <= now {
        return Err(Error::DelegationInvalid);
    }

    let record = DelegationRecord {
        grantor: admin.clone(),
        expiry_ledger,
        permissions: permissions.clone(),
    };

    storage::set_delegation(env, operator, &record);
    storage::index_delegation_operator(env, operator);

    DelegationGranted {
        operator: operator.clone(),
        grantor: admin.clone(),
        expiry_ledger,
        permissions,
    }
    .publish(env);

    Ok(())
}

/// Admin-only: revoke a delegation before it expires.
///
/// Emits [`DelegationRevoked`] only when a still-valid (non-expired) record is
/// removed. No-ops with no event when the operator has no record, or when the
/// stored record has already passed natural expiry (cleanup without a revoke
/// signal).
pub fn revoke_delegation(env: &Env, admin: &Address, operator: &Address) {
    let Some(record) = storage::get_delegation(env, operator) else {
        return;
    };

    let now = env.ledger().sequence();
    storage::remove_delegation(env, operator);
    storage::unindex_delegation_operator(env, operator);

    // Already past natural expiry — remove stale storage but do not emit the
    // early-revocation event (indexers treat expiry as time-based, not revoke).
    if now > record.expiry_ledger {
        return;
    }

    DelegationRevoked {
        operator: operator.clone(),
        grantor: record.grantor,
        revoked_by: admin.clone(),
        permissions: record.permissions,
        at_ledger: now,
    }
    .publish(env);
}

/// Check if `operator` has a valid (non-expired) delegation.
///
/// Natural expiry is silent: when `now > expiry_ledger` this returns `None`
/// without emitting [`DelegationRevoked`].
pub fn get_delegation(env: &Env, operator: &Address) -> Option<DelegationRecord> {
    let record = storage::get_delegation(env, operator)?;
    let now = env.ledger().sequence();
    if now > record.expiry_ledger {
        return None;
    }
    Some(record)
}

/// Build the full ordered scope list for an active record (stable order).
fn collect_scopes(env: &Env, record: &DelegationRecord) -> Vec<ActiveDelegatedScope> {
    let mut scopes: Vec<ActiveDelegatedScope> = Vec::new(env);
    if record.permissions.can_set_fraud_score {
        scopes.push_back(ActiveDelegatedScope {
            scope: DelegatedScopeKind::SetFraudScore,
            grantor: record.grantor.clone(),
            expiry_ledger: record.expiry_ledger,
        });
    }
    if record.permissions.can_set_asset_config {
        scopes.push_back(ActiveDelegatedScope {
            scope: DelegatedScopeKind::SetAssetConfig,
            grantor: record.grantor.clone(),
            expiry_ledger: record.expiry_ledger,
        });
    }
    if record.permissions.can_set_reinsurance {
        scopes.push_back(ActiveDelegatedScope {
            scope: DelegatedScopeKind::SetReinsurance,
            grantor: record.grantor.clone(),
            expiry_ledger: record.expiry_ledger,
        });
    }
    scopes
}

/// Read-only: paginated list of active (non-expired, non-revoked) delegated scopes
/// for `operator`. Safe to call via simulation — does not mutate state.
///
/// `start_after` is the number of scopes to skip (0 = first page).
/// `limit` is clamped to [`PAGE_SIZE_MAX`].
pub fn list_active_delegated_scopes(
    env: &Env,
    operator: &Address,
    start_after: u32,
    limit: u32,
) -> Vec<ActiveDelegatedScope> {
    let mut results: Vec<ActiveDelegatedScope> = Vec::new(env);
    let Some(record) = get_delegation(env, operator) else {
        return results;
    };

    let scopes = collect_scopes(env, &record);
    let cap = limit.min(PAGE_SIZE_MAX);
    let mut idx = start_after;
    while idx < scopes.len() && results.len() < cap {
        if let Some(scope) = scopes.get(idx) {
            results.push_back(scope);
        }
        idx = idx.saturating_add(1);
    }
    results
}
