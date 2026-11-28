use soroban_sdk::{contracterror, contracttype, symbol_short, Address, Env, Vec};

/// Maximum number of claims processed in a single `finalize_expired_batch` call.
pub const MAX_BATCH_SIZE: u32 = 50;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum FinalizationError {
    ClaimNotFound = 1,
    DeadlineNotReached = 2,
    BatchTooLarge = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ClaimOutcome {
    Approved,
    Rejected,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Claim {
    pub approve_votes: u32,
    pub reject_votes: u32,
    pub deadline: u32,
    pub finalized: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimFinalized {
    pub claim_id: u64,
    pub outcome: ClaimOutcome,
    pub approve_votes: u32,
    pub reject_votes: u32,
    pub deadline: u32,
}

fn claim_key(claim_id: u64) -> (soroban_sdk::Symbol, u64) {
    (symbol_short!("claim"), claim_id)
}

fn load_claim(env: &Env, claim_id: u64) -> Result<Claim, FinalizationError> {
    env.storage()
        .persistent()
        .get(&claim_key(claim_id))
        .ok_or(FinalizationError::ClaimNotFound)
}

fn save_claim(env: &Env, claim_id: u64, claim: &Claim) {
    env.storage().persistent().set(&claim_key(claim_id), claim);
}

/// Resolve a single claim after its voting deadline has passed.
///
/// Permissionless: any keeper may call this. Tie-breaking rule:
/// a claim is `Approved` only when `approve_votes > reject_votes`;
/// ties (and any case where reject >= approve) resolve to `Rejected`.
/// Already-finalized claims are skipped without reverting.
pub fn finalize_claim(env: &Env, claim_id: u64) -> Result<Option<ClaimFinalized>, FinalizationError> {
    let mut claim = load_claim(env, claim_id)?;

    if claim.finalized {
        return Ok(None);
    }

    if env.ledger().sequence() < claim.deadline {
        return Err(FinalizationError::DeadlineNotReached);
    }

    let outcome = if claim.approve_votes > claim.reject_votes {
        ClaimOutcome::Approved
    } else {
        ClaimOutcome::Rejected
    };

    claim.finalized = true;
    save_claim(env, claim_id, &claim);

    let event = ClaimFinalized {
        claim_id,
        outcome: outcome.clone(),
        approve_votes: claim.approve_votes,
        reject_votes: claim.reject_votes,
        deadline: claim.deadline,
    };
    env.events().publish((symbol_short!("finalized"), claim_id), event.clone());

    Ok(Some(event))
}

/// Resolve a batch of claims after their voting deadlines have passed.
///
/// Permissionless keeper entrypoint. Batch size is capped at `MAX_BATCH_SIZE`.
/// Already-finalized claims are skipped without reverting; claims whose
/// deadline has not yet passed are also skipped so the batch never reverts
/// on a single ineligible entry. Outcomes are identical to `finalize_claim`
/// for identical inputs.
pub fn finalize_expired_batch(
    env: &Env,
    claim_ids: Vec<u64>,
) -> Result<Vec<ClaimFinalized>, FinalizationError> {
    if claim_ids.len() > MAX_BATCH_SIZE {
        return Err(FinalizationError::BatchTooLarge);
    }

    let mut results: Vec<ClaimFinalized> = Vec::new(env);
    let now = env.ledger().sequence();

    for claim_id in claim_ids.iter() {
        let mut claim = match load_claim(env, claim_id) {
            Ok(c) => c,
            Err(_) => continue,
        };

        if claim.finalized || now < claim.deadline {
            continue;
        }

        let outcome = if claim.approve_votes > claim.reject_votes {
            ClaimOutcome::Approved
        } else {
            ClaimOutcome::Rejected
        };

        claim.finalized = true;
        save_claim(env, claim_id, &claim);

        let event = ClaimFinalized {
            claim_id,
            outcome,
            approve_votes: claim.approve_votes,
            reject_votes: claim.reject_votes,
            deadline: claim.deadline,
        };
        env.events().publish((symbol_short!("finalized"), claim_id), event.clone());
        results.push_back(event);
    }

    Ok(results)
}
