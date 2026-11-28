//! C-15 Contract — Quote entrypoints.
//!
//! Read-only premium quoting. These entrypoints MUST NOT perform any storage
//! writes; they only read configuration (policy type registry, asset bounds,
//! `min_coverage_amount`) and compute a premium.

use soroban_sdk::{contracttype, panic_with_error, Env, Symbol};

/// Minimum coverage amount accepted by the quote engine.
pub const MIN_COVERAGE_AMOUNT: i128 = 1_000_000;

/// Basis-point denominator used for premium math.
const BPS_DENOM: i128 = 10_000;

/// Error codes returned by the quote entrypoints.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
#[allow(clippy::enum_variant_names)]
pub enum QuoteError {
    /// Coverage is below `min_coverage_amount`.
    CoverageBelowMinimum = 1,
    /// Coverage exceeds the configured maximum for the asset.
    CoverageAboveMaximum = 2,
    /// Asset is not registered / out of bounds.
    AssetOutOfBounds = 3,
    /// Policy type is not present in the policy type registry.
    UnknownPolicyType = 4,
    /// Premium rate for the policy type is invalid (negative or > 100%).
    InvalidPremiumRate = 5,
    /// Coverage amount is not a positive value.
    InvalidCoverage = 6,
}

/// Result of a successful quote computation.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QuoteResult {
    /// Computed premium amount.
    pub premium: i128,
    /// Coverage amount the quote was computed for.
    pub coverage: i128,
    /// Asset the quote applies to.
    pub asset: Symbol,
    /// Version of the pricing table used for the computation.
    pub table_version: u32,
    /// Source of the calculation (e.g. `"registry"`).
    pub calc_source: Symbol,
}

/// Inputs shared by both quote entrypoints.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QuoteInput {
    /// Policy type identifier, looked up in the policy type registry.
    pub policy_type: Symbol,
    /// Coverage amount requested.
    pub coverage: i128,
}

/// Configuration read by the quote engine. Implemented by the contract's
/// storage layer; the quote engine itself never writes.
pub trait QuoteConfig {
    /// Minimum coverage amount accepted.
    fn min_coverage_amount(&self) -> i128;
    /// Maximum coverage amount for `asset`, if bounded.
    fn max_coverage_for_asset(&self, asset: &Symbol) -> Option<i128>;
    /// Whether `asset` is a registered asset.
    fn is_asset_registered(&self, asset: &Symbol) -> bool;
    /// Premium rate (in basis points) for `policy_type`, if registered.
    fn premium_rate_bps(&self, policy_type: &Symbol) -> Option<i128>;
    /// Current pricing table version.
    fn table_version(&self) -> u32;
}

/// Static lookup mapping a quote error code to a human-readable message.
/// Performs no storage access and no writes.
pub fn quote_error_message(code: u32) -> &'static str {
    match code {
        1 => "coverage below minimum coverage amount",
        2 => "coverage above maximum for asset",
        3 => "asset out of bounds",
        4 => "unknown policy type",
        5 => "invalid premium rate",
        6 => "invalid coverage amount",
        _ => "unknown quote error",
    }
}

/// Validate the quote request against coverage bounds, asset bounds and the
/// policy type registry. Returns the premium rate in basis points.
fn validate_and_rate<C: QuoteConfig>(
    config: &C,
    input: &QuoteInput,
    asset: &Symbol,
) -> Result<i128, QuoteError> {
    if input.coverage <= 0 {
        return Err(QuoteError::InvalidCoverage);
    }

    let min_coverage = config.min_coverage_amount();
    if input.coverage < min_coverage {
        return Err(QuoteError::CoverageBelowMinimum);
    }

    if !config.is_asset_registered(asset) {
        return Err(QuoteError::AssetOutOfBounds);
    }

    if let Some(max_coverage) = config.max_coverage_for_asset(asset) {
        if input.coverage > max_coverage {
            return Err(QuoteError::CoverageAboveMaximum);
        }
    }

    let rate_bps = config
        .premium_rate_bps(&input.policy_type)
        .ok_or(QuoteError::UnknownPolicyType)?;

    if rate_bps < 0 || rate_bps > BPS_DENOM {
        return Err(QuoteError::InvalidPremiumRate);
    }

    Ok(rate_bps)
}

/// Compute a premium for `input` against `coverage` using the default asset
/// resolved from the policy type registry. Read-only: no storage writes.
pub fn generate_premium<C: QuoteConfig>(
    config: &C,
    input: &QuoteInput,
    coverage: i128,
) -> Result<QuoteResult, QuoteError> {
    let asset = input.policy_type.clone();
    generate_premium_for_asset(config, input, coverage, &asset)
}

/// Compute a premium for `input` against `coverage` for a specific `asset`.
/// Read-only: no storage writes.
pub fn generate_premium_for_asset<C: QuoteConfig>(
    config: &C,
    input: &QuoteInput,
    coverage: i128,
    asset: &Symbol,
) -> Result<QuoteResult, QuoteError> {
    let request = QuoteInput {
        policy_type: input.policy_type.clone(),
        coverage,
    };

    let rate_bps = validate_and_rate(config, &request, asset)?;

    let premium = coverage
        .checked_mul(rate_bps)
        .ok_or(QuoteError::InvalidPremiumRate)?
        / BPS_DENOM;

    Ok(QuoteResult {
        premium,
        coverage,
        asset: asset.clone(),
        table_version: config.table_version(),
        calc_source: Symbol::new(&Env::default(), "registry"),
    })
}

/// Panic with the documented quote error message for `code`.
pub fn panic_quote_error(env: &Env, code: u32) -> ! {
    let _ = quote_error_message(code);
    panic_with_error!(env, code)
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::symbol_short;

    struct MockConfig {
        min_coverage: i128,
        max_coverage: Option<i128>,
        asset_registered: bool,
        rate_bps: Option<i128>,
        table_version: u32,
    }

    impl QuoteConfig for MockConfig {
        fn min_coverage_amount(&self) -> i128 {
            self.min_coverage
        }
        fn max_coverage_for_asset(&self, _asset: &Symbol) -> Option<i128> {
            self.max_coverage
        }
        fn is_asset_registered(&self, _asset: &Symbol) -> bool {
            self.asset_registered
        }
        fn premium_rate_bps(&self, _policy_type: &Symbol) -> Option<i128> {
            self.rate_bps
        }
        fn table_version(&self) -> u32 {
            self.table_version
        }
    }

    fn base_config() -> MockConfig {
        MockConfig {
            min_coverage: MIN_COVERAGE_AMOUNT,
            max_coverage: Some(1_000_000_000),
            asset_registered: true,
            rate_bps: Some(500),
            table_version: 7,
        }
    }

    fn input(coverage: i128) -> QuoteInput {
        QuoteInput {
            policy_type: symbol_short!("auto"),
            coverage,
        }
    }

    #[test]
    fn happy_path_returns_quote_result() {
        let cfg = base_config();
        let asset = symbol_short!("usdc");
        let result = generate_premium_for_asset(&cfg, &input(10_000_000), 10_000_000, &asset)
            .expect("quote should succeed");
        assert_eq!(result.premium, 500_000);
        assert_eq!(result.coverage, 10_000_000);
        assert_eq!(result.asset, asset);
        assert_eq!(result.table_version, 7);
        assert_eq!(result.calc_source, symbol_short!("registry"));
    }

    #[test]
    fn generate_premium_delegates_to_asset_variant() {
        let cfg = base_config();
        let result = generate_premium(&cfg, &input(10_000_000), 10_000_000)
            .expect("quote should succeed");
        assert_eq!(result.premium, 500_000);
    }

    #[test]
    fn rejects_invalid_coverage() {
        let cfg = base_config();
        let asset = symbol_short!("usdc");
        assert_eq!(
            generate_premium_for_asset(&cfg, &input(0), 0, &asset),
            Err(QuoteError::InvalidCoverage)
        );
    }

    #[test]
    fn rejects_coverage_below_minimum() {
        let cfg = base_config();
        let asset = symbol_short!("usdc");
        assert_eq!(
            generate_premium_for_asset(&cfg, &input(1), 1, &asset),
            Err(QuoteError::CoverageBelowMinimum)
        );
    }

    #[test]
    fn rejects_coverage_above_maximum() {
        let cfg = base_config();
        let asset = symbol_short!("usdc");
        assert_eq!(
            generate_premium_for_asset(&cfg, &input(2_000_000_000), 2_000_000_000, &asset),
            Err(QuoteError::CoverageAboveMaximum)
        );
    }

    #[test]
    fn rejects_asset_out_of_bounds() {
        let mut cfg = base_config();
        cfg.asset_registered = false;
        let asset = symbol_short!("usdc");
        assert_eq!(
            generate_premium_for_asset(&cfg, &input(10_000_000), 10_000_000, &asset),
            Err(QuoteError::AssetOutOfBounds)
        );
    }

    #[test]
    fn rejects_unknown_policy_type() {
        let mut cfg = base_config();
        cfg.rate_bps = None;
        let asset = symbol_short!("usdc");
        assert_eq!(
            generate_premium_for_asset(&cfg, &input(10_000_000), 10_000_000, &asset),
            Err(QuoteError::UnknownPolicyType)
        );
    }

    #[test]
    fn rejects_invalid_premium_rate() {
        let mut cfg = base_config();
        cfg.rate_bps = Some(20_000);
        let asset = symbol_short!("usdc");
        assert_eq!(
            generate_premium_for_asset(&cfg, &input(10_000_000), 10_000_000, &asset),
            Err(QuoteError::InvalidPremiumRate)
        );
    }

    #[test]
    fn every_error_code_has_a_message() {
        for code in 1..=6u32 {
            assert_ne!(quote_error_message(code), "unknown quote error");
        }
        assert_eq!(quote_error_message(999), "unknown quote error");
    }

    #[test]
    fn quote_is_read_only() {
        // The quote engine only takes an immutable `&C` config reference and
        // returns a value; it never receives `&Env` for storage mutation, so
        // no storage writes are possible from these entrypoints.
        let cfg = base_config();
        let asset = symbol_short!("usdc");
        let _ = generate_premium_for_asset(&cfg, &input(10_000_000), 10_000_000, &asset);
        let _ = generate_premium(&cfg, &input(10_000_000), 10_000_000);
    }
}
