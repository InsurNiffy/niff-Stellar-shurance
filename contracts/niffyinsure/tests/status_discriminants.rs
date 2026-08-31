//! Issue #1162 — Asserts that `ClaimStatus` discriminant values remain stable.
//!
//! These values are persisted on-chain in `Claim::status` and indexed
//! by the backend.  Any change to an existing discriminant is a
//! **breaking change** that would corrupt stored data and must never happen.
//!
//! To add a new variant: append at the end with the next sequential value
//! and add it here.  Do NOT renumber existing variants.

use niffyinsure::types::ClaimStatus;

#[test]
fn claim_status_discriminants_are_stable() {
    assert_eq!(ClaimStatus::Processing as u32, 0);
    assert_eq!(ClaimStatus::Pending as u32, 1);
    assert_eq!(ClaimStatus::Approved as u32, 2);
    assert_eq!(ClaimStatus::PayoutTimeout as u32, 3);
    assert_eq!(ClaimStatus::Paid as u32, 4);
    assert_eq!(ClaimStatus::Rejected as u32, 5);
    assert_eq!(ClaimStatus::UnderAppeal as u32, 6);
    assert_eq!(ClaimStatus::AppealApproved as u32, 7);
    assert_eq!(ClaimStatus::AppealRejected as u32, 8);
    assert_eq!(ClaimStatus::Withdrawn as u32, 9);
    assert_eq!(ClaimStatus::Disputed as u32, 10);
    assert_eq!(ClaimStatus::Appealed as u32, 11);
}
