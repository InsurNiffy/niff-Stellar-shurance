

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
