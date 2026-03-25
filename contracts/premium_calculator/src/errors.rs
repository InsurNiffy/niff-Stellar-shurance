use soroban_sdk::{contracterror};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CalcError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    InvalidBaseAmount = 4,
    SafetyScoreOutOfRange = 5,
    MissingRegionMultiplier = 6,
    MissingAgeMultiplier = 7,
    MissingCoverageMultiplier = 8,
    RegionMultiplierOutOfBounds = 9,
    AgeMultiplierOutOfBounds = 10,
    CoverageMultiplierOutOfBounds = 11,
    SafetyDiscountOutOfBounds = 12,
    InvalidConfigVersion = 13,
    Overflow = 14,
    DivideByZero = 15,
    NegativePremiumNotSupported = 16,
    Paused = 17,
}
