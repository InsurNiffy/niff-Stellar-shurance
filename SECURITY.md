

## Initialization Replay Guard

The contract's `initialize` entrypoint includes a replay guard that prevents
re-initialization after deployment. The guard works as follows:

1. **Check first, write never:** Before any state mutation, `initialize`
   checks `env.storage().instance().has(&DataKey::Admin)`. If the key exists,
   it returns `Err(InitError::AlreadyInitialized)` immediately.

2. **No partial writes:** Because the guard fires before `set_admin`,
   `set_token`, or any other storage write, a replay attempt cannot corrupt
   existing configuration — not even partially.

3. **Attacker scenarios blocked:**
   - Re-calling init with a different admin address → reverts
   - Re-calling init with a different token address → reverts
   - Re-calling init with the same arguments → reverts

4. **Error type:** `InitError::AlreadyInitialized` (discriminant 1)

### Test coverage

See `contracts/niffyinsure/tests/init_replay_guard.rs` for automated tests
that verify second-call revert behavior with same args, different admin, and
different token.

## Admin Rotation Co-Signer Requirement

The multi-step admin rotation flow enforces a co-signer requirement on the
`accept_admin` entrypoint to prevent a single compromised key from unilaterally
taking over admin control.

1. **Distinct co-signer required:** `accept_admin` requires a second address
   (`co_signer`) to authorize the rotation in addition to the pending new admin.

2. **Co-signer must be distinct:** The co-signer must differ from both the
   pending new admin and the current admin. A rotation where the co-signer
   equals either party is rejected.

3. **Attacker scenarios blocked:**
   - Calling `accept_admin` without a co-signer → reverts
   - Calling `accept_admin` with the co-signer equal to the new admin → reverts
   - Calling `accept_admin` with the co-signer equal to the current admin → reverts

4. **Error type:** `AdminError::InvalidCoSigner`

### Test coverage

See `contracts/niffyinsure/tests/admin_rotation.rs` for penetration test
scenarios covering missing/duplicate co-signer rejection and successful
co-signed acceptance.
