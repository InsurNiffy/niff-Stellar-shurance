//! Shared helpers for integration tests.

#![allow(dead_code)]

use niffyinsure::types::ClaimEvidenceEntry;
use soroban_sdk::{BytesN, Env, String, Vec};

/// Non-zero 32-byte commitment (not necessarily a real SHA-256).
pub fn non_zero_hash(env: &Env) -> BytesN<32> {
    let mut a = [0u8; 32];
    a[0] = 1;
    BytesN::from_array(env, &a)
}

/// Deterministic sample digest for persistence assertions.
pub fn sample_digest(env: &Env) -> BytesN<32> {
    let mut a = [0u8; 32];
    for i in 0..32usize {
        a[i] = (i as u8).wrapping_add(1);
    }
    BytesN::from_array(env, &a)
}

pub fn zero_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

pub fn empty_evidence(env: &Env) -> Vec<ClaimEvidenceEntry> {
    Vec::new(env)
}

pub fn one_url_evidence(env: &Env, url: &str) -> Vec<ClaimEvidenceEntry> {
    let mut v = Vec::new(env);
    v.push_back(ClaimEvidenceEntry {
        url: String::from_str(env, url),
        hash: non_zero_hash(env),
    });
    v
}

pub fn one_url_evidence_with_hash(
    env: &Env,
    url: &str,
    hash: BytesN<32>,
) -> Vec<ClaimEvidenceEntry> {
    let mut v = Vec::new(env);
    v.push_back(ClaimEvidenceEntry {
        url: String::from_str(env, url),
        hash,
    });
    v
}
