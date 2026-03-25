use crate::{
    storage,
    types::{Claim, ClaimProcessed, ClaimStatus},
    validate::Error,
};
use soroban_sdk::{symbol_short, token, Address, Env};

pub fn process_claim(env: &Env, claim_id: u64) -> Result<(), Error> {
    let mut claim = storage::get_claim(env, claim_id).ok_or(Error::ClaimNotFound)?;

    if claim.status == ClaimStatus::Paid {
        return Err(Error::AlreadyPaid);
    }
    if claim.status != ClaimStatus::Approved {
        return Err(Error::ClaimNotApproved);
    }
    if claim.amount <= 0 {
        return Err(Error::ClaimAmountZero);
    }
    if !is_allowed_asset(env, &claim.asset) {
        return Err(Error::InvalidAsset);
    }

    let token_client = token::Client::new(env, &claim.asset);
    let treasury = treasury_address(env);
    check_treasury_balance(&token_client, &treasury, claim.amount)?;

    token_client.transfer(&treasury, &claim.claimant, &claim.amount);

    claim.status = ClaimStatus::Paid;
    claim.paid_at = Some(env.ledger().timestamp());
    storage::set_claim(env, &claim);
    emit_claim_processed(env, &claim);

    Ok(())
}

pub fn get_claim(env: &Env, claim_id: u64) -> Result<Claim, Error> {
    storage::get_claim(env, claim_id).ok_or(Error::ClaimNotFound)
}

pub fn is_allowed_asset(env: &Env, asset: &Address) -> bool {
    storage::is_allowed_asset(env, asset)
}

pub fn set_allowed_asset(env: &Env, asset: &Address, allowed: bool) {
    storage::set_allowed_asset(env, asset, allowed);
}

pub fn treasury_address(env: &Env) -> Address {
    env.current_contract_address()
}

fn check_treasury_balance(
    token_client: &token::Client,
    treasury: &Address,
    amount: i128,
) -> Result<(), Error> {
    if token_client.balance(treasury) < amount {
        return Err(Error::InsufficientTreasury);
    }
    Ok(())
}

fn emit_claim_processed(env: &Env, claim: &Claim) {
    env.events().publish(
        (symbol_short!("claim_paid"), claim.claim_id),
        ClaimProcessed {
            claim_id: claim.claim_id,
            recipient: claim.claimant.clone(),
            amount: claim.amount,
            asset: claim.asset.clone(),
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::NiffyInsureClient;
    use soroban_sdk::{testutils::Address as _, token, Address, Env, String, Vec};

    fn setup() -> (
        Env,
        NiffyInsureClient,
        Address,
        token::Client,
        token::StellarAssetClient,
        Address,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(crate::NiffyInsure, ());
        let client = NiffyInsureClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
        let token_client = token::Client::new(&env, &token_id);
        let token_admin_client = token::StellarAssetClient::new(&env, &token_id);

        client.initialize(&admin, &token_id);

        (
            env,
            client,
            contract_id,
            token_client,
            token_admin_client,
            token_id,
        )
    }

    fn approved_claim(
        env: &Env,
        claimant: &Address,
        asset: &Address,
        amount: i128,
    ) -> Claim {
        Claim {
            claim_id: 1,
            policy_id: 7,
            claimant: claimant.clone(),
            amount,
            asset: asset.clone(),
            details: String::from_str(env, "approved fire claim"),
            image_urls: Vec::new(env),
            status: ClaimStatus::Approved,
            approve_votes: 2,
            reject_votes: 0,
            paid_at: None,
        }
    }

    #[test]
    fn process_claim_transfers_tokens_and_marks_claim_paid() {
        let (env, client, contract_id, token_client, token_admin_client, token_id) = setup();
        let claimant = Address::generate(&env);
        let treasury = contract_id.clone();
        let claim = approved_claim(&env, &claimant, &token_id, 5_000);

        token_admin_client.mint(&treasury, &10_000);
        storage::set_claim(&env, &claim);

        let before_events = env.events().all().len();
        client.process_claim(&claim.claim_id);

        let stored = client.get_claim(&claim.claim_id);
        assert_eq!(token_client.balance(&treasury), 5_000);
        assert_eq!(token_client.balance(&claimant), 5_000);
        assert_eq!(stored.status, ClaimStatus::Paid);
        assert!(stored.paid_at.is_some());
        assert!(env.events().all().len() > before_events);
    }

    #[test]
    fn process_claim_reverts_when_treasury_is_short() {
        let (env, client, contract_id, token_client, token_admin_client, token_id) = setup();
        let claimant = Address::generate(&env);
        let treasury = contract_id.clone();
        let claim = approved_claim(&env, &claimant, &token_id, 5_000);

        token_admin_client.mint(&treasury, &1_000);
        storage::set_claim(&env, &claim);

        let result = client.try_process_claim(&claim.claim_id);
        assert!(result.is_err());

        let stored = client.get_claim(&claim.claim_id);
        assert_eq!(stored.status, ClaimStatus::Approved);
        assert_eq!(stored.paid_at, None);
        assert_eq!(token_client.balance(&treasury), 1_000);
        assert_eq!(token_client.balance(&claimant), 0);
    }

    #[test]
    fn process_claim_is_idempotent() {
        let (env, client, contract_id, _token_client, token_admin_client, token_id) = setup();
        let claimant = Address::generate(&env);
        let treasury = contract_id.clone();
        let claim = approved_claim(&env, &claimant, &token_id, 5_000);

        token_admin_client.mint(&treasury, &10_000);
        storage::set_claim(&env, &claim);

        client.process_claim(&claim.claim_id);
        let second = client.try_process_claim(&claim.claim_id);
        assert!(second.is_err());
        assert_eq!(client.get_claim(&claim.claim_id).status, ClaimStatus::Paid);
    }

    #[test]
    fn process_claim_rejects_assets_outside_the_allowlist() {
        let (env, client, contract_id, token_client, token_admin_client, _token_id) = setup();
        let claimant = Address::generate(&env);
        let treasury = contract_id.clone();

        let other_admin = Address::generate(&env);
        let other_asset = env
            .register_stellar_asset_contract_v2(other_admin.clone())
            .address();
        let claim = approved_claim(&env, &claimant, &other_asset, 5_000);

        token_admin_client.mint(&treasury, &10_000);
        storage::set_claim(&env, &claim);

        let result = client.try_process_claim(&claim.claim_id);
        assert!(result.is_err());
        assert_eq!(client.get_claim(&claim.claim_id).status, ClaimStatus::Approved);
        assert_eq!(token_client.balance(&treasury), 10_000);
    }
}
