use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Map, Symbol, Vec};

const MAX_DELEGATORS_PER_DELEGATE: u32 = 32;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VoteDelegation {
    pub delegate: Address,
    pub expiry_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Claim {
    pub id: u64,
    pub voter_snapshot: Vec<Address>,
    pub votes_for: u32,
    pub votes_against: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VoteChoice {
    For,
    Against,
}

#[contract]
pub struct ClaimVotingContract;

#[contractimpl]
impl ClaimVotingContract {
    /// Delegate `delegator`'s claim-voting power to `delegate` until `expiry_ledger`.
    ///
    /// Rejects delegation chains (A -> B -> C) explicitly: a delegator may not
    /// delegate to someone who is themselves delegating, and a delegate may not
    /// already be delegating to another account.
    pub fn delegate_vote(
        env: Env,
        delegator: Address,
        delegate: Address,
        expiry_ledger: u32,
    ) {
        delegator.require_auth();

        if delegator == delegate {
            panic!("cannot delegate to self");
        }

        if expiry_ledger <= env.ledger().sequence() {
            panic!("expiry ledger must be in the future");
        }

        // Reject delegation chains: the delegate must not already be delegating
        // their own vote to a third party.
        if Self::get_vote_delegation(env.clone(), delegate.clone()).is_some() {
            panic!("delegation chains are not allowed");
        }

        // Reject delegation chains: the delegator must not already be a delegate
        // for other voters (otherwise A -> B -> C could form).
        let delegators: Vec<Address> = env
            .storage()
            .persistent()
            .get(&Self::delegators_key(&delegate))
            .unwrap_or(Vec::new(&env));
        if !delegators.is_empty() {
            panic!("delegation chains are not allowed");
        }

        // Cap the number of delegators per delegate to bound voting cost.
        let mut delegators: Vec<Address> = env
            .storage()
            .persistent()
            .get(&Self::delegators_key(&delegate))
            .unwrap_or(Vec::new(&env));
        if delegators.len() >= MAX_DELEGATORS_PER_DELEGATE {
            panic!("delegator cap exceeded");
        }

        let delegation = VoteDelegation {
            delegate: delegate.clone(),
            expiry_ledger,
        };
        env.storage()
            .persistent()
            .set(&Self::delegation_key(&delegator), &delegation);

        delegators.push_back(delegator.clone());
        env.storage()
            .persistent()
            .set(&Self::delegators_key(&delegate), &delegators);

        env.events().publish(
            (symbol_short!("VoteDelegated"), delegator.clone(), delegate.clone()),
            expiry_ledger,
        );
    }

    /// Revoke `delegator`'s vote delegation, if any.
    pub fn revoke_vote_delegation(env: Env, delegator: Address) {
        delegator.require_auth();

        let delegation: VoteDelegation = match env
            .storage()
            .persistent()
            .get(&Self::delegation_key(&delegator))
        {
            Some(d) => d,
            None => return,
        };

        env.storage()
            .persistent()
            .remove(&Self::delegation_key(&delegator));

        let mut delegators: Vec<Address> = env
            .storage()
            .persistent()
            .get(&Self::delegators_key(&delegation.delegate))
            .unwrap_or(Vec::new(&env));
        if let Some(idx) = delegators.first_index_of(&delegator) {
            delegators.remove(idx);
        }
        env.storage()
            .persistent()
            .set(&Self::delegators_key(&delegation.delegate), &delegators);

        env.events().publish(
            (symbol_short!("VoteDelegationRevoked"), delegator.clone()),
            delegation.delegate,
        );
    }

    /// Return the active delegation for `delegator`, or `None` if there is none
    /// or it has expired.
    pub fn get_vote_delegation(env: Env, delegator: Address) -> Option<VoteDelegation> {
        let delegation: VoteDelegation = env
            .storage()
            .persistent()
            .get(&Self::delegation_key(&delegator))?;

        if delegation.expiry_ledger <= env.ledger().sequence() {
            return None;
        }

        Some(delegation)
    }

    /// Cast a vote on `claim_id` as `voter`.
    ///
    /// If `voter` is a delegate, the vote is also applied on behalf of every
    /// delegator in the claim's voter snapshot whose delegation is active and
    /// points at `voter`. Each delegator's vote counts once. A delegator voting
    /// directly overrides their delegation for that claim.
    pub fn cast_vote(env: Env, voter: Address, claim_id: u64, choice: VoteChoice) {
        voter.require_auth();

        let mut claim: Claim = env
            .storage()
            .persistent()
            .get(&Self::claim_key(claim_id))
            .expect("claim not found");

        if !claim.voter_snapshot.contains(&voter) {
            panic!("voter not in snapshot");
        }

        // Direct vote overrides any delegation for this claim.
        let mut voted: Map<Address, bool> = env
            .storage()
            .persistent()
            .get(&Self::voted_key(claim_id))
            .unwrap_or(Map::new(&env));
        if voted.get(voter.clone()).unwrap_or(false) {
            panic!("already voted");
        }
        voted.set(voter.clone(), true);
        Self::tally(&mut claim, &choice);

        // Apply delegated votes for delegators in the snapshot who delegated to
        // this voter and have not voted directly.
        let delegators: Vec<Address> = env
            .storage()
            .persistent()
            .get(&Self::delegators_key(&voter))
            .unwrap_or(Vec::new(&env));
        for delegator in delegators.iter() {
            if !claim.voter_snapshot.contains(&delegator) {
                continue;
            }
            if voted.get(delegator.clone()).unwrap_or(false) {
                continue;
            }
            let active = match Self::get_vote_delegation(env.clone(), delegator.clone()) {
                Some(d) => d.delegate == voter,
                None => false,
            };
            if !active {
                continue;
            }
            voted.set(delegator.clone(), true);
            Self::tally(&mut claim, &choice);
        }

        env.storage()
            .persistent()
            .set(&Self::voted_key(claim_id), &voted);
        env.storage()
            .persistent()
            .set(&Self::claim_key(claim_id), &claim);
    }

    fn tally(claim: &mut Claim, choice: &VoteChoice) {
        match choice {
            VoteChoice::For => claim.votes_for += 1,
            VoteChoice::Against => claim.votes_against += 1,
        }
    }

    fn delegation_key(delegator: &Address) -> (Symbol, Address) {
        (symbol_short!("delegation"), delegator.clone())
    }

    fn delegators_key(delegate: &Address) -> (Symbol, Address) {
        (symbol_short!("delegators"), delegate.clone())
    }

    fn claim_key(claim_id: u64) -> (Symbol, u64) {
        (symbol_short!("claim"), claim_id)
    }

    fn voted_key(claim_id: u64) -> (Symbol, u64) {
        (symbol_short!("voted"), claim_id)
    }
}
