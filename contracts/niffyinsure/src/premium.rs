use crate::types::{PolicyType, RegionTier};

/// Base annual premium in stroops (1 XLM = 10_000_000 stroops).
#[allow(dead_code)]
const BASE: i128 = 10_000_000;

/// Returns the annual premium for the given risk profile.
/// Called from policy.rs once feat/policy-lifecycle lands.
///
/// # Overflow analysis
/// MAX sum of factors = type(20) + region(14) + age(15) + risk_score(10) = 59.
/// BASE * 59 = 590_000_000 — well within i128::MAX (~1.7 × 10^38). Safe.
/// risk_score cast from u32 to i128 is lossless for any u32 value.
#[allow(dead_code)]
pub fn compute_premium(
    policy_type: &PolicyType,
    region: &RegionTier,
    age: u32,
    risk_score: u32, // 1–10; higher = riskier
) -> i128 {
    let type_factor: i128 = match policy_type {
        PolicyType::Auto => 15,
        PolicyType::Health => 20,
        PolicyType::Property => 10,
    };
    let region_factor: i128 = match region {
        RegionTier::Low => 8,
        RegionTier::Medium => 10,
        RegionTier::High => 14,
    };
    let age_factor: i128 = if age < 25 {
        15
    } else if age > 60 {
        13
    } else {
        10
    };
    BASE * (type_factor + region_factor + age_factor + risk_score as i128) / 10
}
