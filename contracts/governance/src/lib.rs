use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, Map, Symbol, Vec};

const ADMIN: Symbol = symbol_short!("ADMIN");
const CLAIM_COUNT: Symbol = symbol_short!("CLAIMS");
const REVEAL_DEADLINE: Symbol = symbol_short!("REVEAL_DL");

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Claim {
    pub id: u32,
    pub claimant: Address,
    pub amount: i128,
    pub approved: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Commitment {
    pub commitment: BytesN<32>,
    pub committed_at: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Tally {
    pub yes: u32,
    pub no: u32,
}

/// Scope of a delegation: either global (all claims) or a specific claim.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DelegationScope {
    Global,
    Claim(u32),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Delegation {
    pub delegatee: Address,
    pub scope: DelegationScope,
}

#[contract]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContract {
    pub fn initialize(env: Env, admin: Address, reveal_deadline_ledger: u32) {
        if env.storage().instance().has(&ADMIN) {
            panic!("already initialized");
        }
        env.storage().instance().set(&ADMIN, &admin);
        env.storage().instance().set(&CLAIM_COUNT, &0u32);
        env.storage().instance().set(&REVEAL_DEADLINE, &reveal_deadline_ledger);
    }

    pub fn create_claim(env: Env, claimant: Address, amount: i128) -> u32 {
        claimant.require_auth();
        let mut count: u32 = env.storage().instance().get(&CLAIM_COUNT).unwrap_or(0);
        count += 1;
        let claim = Claim {
            id: count,
            claimant,
            amount,
            approved: false,
        };
        env.storage().persistent().set(&(symbol_short!("CLAIM"), count), &claim);
        env.storage().instance().set(&CLAIM_COUNT, &count);
        count
    }

    pub fn get_claim(env: Env, claim_id: u32) -> Claim {
        env.storage()
            .persistent()
            .get(&(symbol_short!("CLAIM"), claim_id))
            .expect("claim not found")
    }

    pub fn reveal_deadline_ledger(env: Env) -> u32 {
        env.storage().instance().get(&REVEAL_DEADLINE).unwrap_or(0)
    }

    /// Delegate vote power from `delegator` to `delegatee` for the given scope.
    /// Delegation chains are limited to depth 1: a delegatee that has itself
    /// delegated cannot be used as a target, preventing cycles.
    pub fn delegate(env: Env, delegator: Address, delegatee: Address, scope: DelegationScope) {
        delegator.require_auth();
        if delegator == delegatee {
            panic!("cannot delegate to self");
        }
        // Depth limited to 1: the delegatee must not itself be a delegator.
        if env
            .storage()
            .persistent()
            .has(&(symbol_short!("DELEG"), delegatee.clone()))
        {
            panic!("delegation chain depth exceeded");
        }
        let record = Delegation {
            delegatee: delegatee.clone(),
            scope: scope.clone(),
        };
        env.storage()
            .persistent()
            .set(&(symbol_short!("DELEG"), delegator.clone()), &record);
        env.events()
            .publish((symbol_short!("DelegationSet"), delegator), (delegatee, scope));
    }

    /// Revoke any delegation previously set by `delegator`.
    pub fn revoke_delegation(env: Env, delegator: Address) {
        delegator.require_auth();
        let key = (symbol_short!("DELEG"), delegator.clone());
        if env.storage().persistent().has(&key) {
            env.storage().persistent().remove(&key);
        }
        env.events()
            .publish((symbol_short!("DelegationRevoked"), delegator), ());
    }

    /// Resolve the effective voter and power for a vote on `claim_id`.
    /// If `voter` has delegated for this claim (or globally), the delegatee
    /// becomes the effective voter. Depth is limited to 1.
    pub fn resolve_voter(env: Env, voter: Address, claim_id: u32) -> Address {
        if let Some(record) = Self::get_delegation(&env, &voter) {
            let applies = match record.scope {
                DelegationScope::Global => true,
                DelegationScope::Claim(id) => id == claim_id,
            };
            if applies {
                return record.delegatee;
            }
        }
        voter
    }

    pub fn get_delegation(env: Env, delegator: Address) -> Option<Delegation> {
        Self::get_delegation(&env, &delegator)
    }

    fn get_delegation(env: &Env, delegator: &Address) -> Option<Delegation> {
        env.storage()
            .persistent()
            .get(&(symbol_short!("DELEG"), delegator.clone()))
    }

    /// Store a commitment (hash of vote || salt) for the given voter and claim.
    /// The tally is NOT updated here; it is only updated on reveal.
    pub fn commit_vote(env: Env, voter: Address, claim_id: u32, commitment: BytesN<32>) {
        voter.require_auth();
        let key = (symbol_short!("COMMIT"), claim_id, voter.clone());
        if env.storage().persistent().has(&key) {
            panic!("duplicate commit");
        }
        let record = Commitment {
            commitment,
            committed_at: env.ledger().sequence(),
        };
        env.storage().persistent().set(&key, &record);
    }

    /// Reveal a previously committed vote. Verifies the commitment matches
    /// hash(vote || salt). If the reveal deadline has passed, the reveal is
    /// inert: it does not update the tally.
    pub fn reveal_vote(env: Env, voter: Address, claim_id: u32, vote: bool, salt: BytesN<32>) {
        voter.require_auth();
        let key = (symbol_short!("COMMIT"), claim_id, voter.clone());
        let record: Commitment = env
            .storage()
            .persistent()
            .get(&key)
            .expect("no commitment");

        let expected = Self::compute_commitment(&env, vote, &salt);
        if expected != record.commitment {
            panic!("invalid commitment: wrong salt or vote");
        }

        // Consume the commitment so it cannot be revealed twice.
        env.storage().persistent().remove(&key);

        let deadline: u32 = env.storage().instance().get(&REVEAL_DEADLINE).unwrap_or(0);
        if env.ledger().sequence() > deadline {
            // Expired reveal: inert, do not update tally.
            return;
        }

        let tally_key = (symbol_short!("TALLY"), claim_id);
        let mut tally: Tally = env
            .storage()
            .persistent()
            .get(&tally_key)
            .unwrap_or(Tally { yes: 0, no: 0 });
        if vote {
            tally.yes += 1;
        } else {
            tally.no += 1;
        }
        env.storage().persistent().set(&tally_key, &tally);
    }

    pub fn get_tally(env: Env, claim_id: u32) -> Tally {
        env.storage()
            .persistent()
            .get(&(symbol_short!("TALLY"), claim_id))
            .unwrap_or(Tally { yes: 0, no: 0 })
    }

    fn compute_commitment(env: &Env, vote: bool, salt: &BytesN<32>) -> BytesN<32> {
        let mut data = soroban_sdk::Bytes::new(env);
        data.push_back(if vote { 1u8 } else { 0u8 });
        let salt_bytes = salt.to_array();
        for b in salt_bytes.iter() {
            data.push_back(*b);
        }
        env.crypto().sha256(&data).into()
    }
}
