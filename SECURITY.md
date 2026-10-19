

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

## Mainnet Launch Readiness Checklist

Tracking issue: #1718. **Priority: Critical. Layer: All.**

All items below must be resolved before deploying with
`STELLAR_NETWORK=mainnet`. Each item lists its status, an owner placeholder,
and acceptance criteria. Update status as work lands; do not flip an item to
`Done` without the acceptance criteria being demonstrably met.

Status legend: `TODO` · `In progress` · `Blocked` · `Done`

### Contract

| Item | Status | Owner | Acceptance criteria |
| --- | --- | --- | --- |
| Multi-sig admin for treasury sweeps | TODO | @contract-owner | Treasury sweep entrypoints require M-of-N admin signatures; single-key sweep path removed; tests cover threshold and below-threshold rejection. |
| Event replay protection (nonce enforcement) | TODO | @contract-owner | Every state-changing event carries a monotonic nonce; replayed or out-of-order events revert; tests cover replay and gap cases. |
| Oracle sign-then-verify pipeline | TODO | @contract-owner | Oracle submissions are signed off-chain and verified on-chain before state mutation; invalid signatures revert; tests cover tampered payloads. |
| Admin rotation co-signer enforcement | TODO | @contract-owner | Admin rotation requires co-signature from the outgoing admin; unauthorized rotations revert; tests cover missing and mismatched co-signer. |

### Backend

| Item | Status | Owner | Acceptance criteria |
| --- | --- | --- | --- |
| Multi-tenant query isolation audit | TODO | @backend-owner | Audit confirms every query is scoped by tenant; cross-tenant access attempts are denied and covered by tests. |
| Chain module network passphrase validation | TODO | @backend-owner | Chain module validates the configured network passphrase against `STELLAR_NETWORK`; mismatches fail fast at startup. |
| Per-wallet rate limits for claim filing | TODO | @backend-owner | Claim filing is rate-limited per wallet; exceeding the limit returns a clear error; tests cover limit and reset behavior. |
| Webhook SSRF periodic re-validation | TODO | @backend-owner | Webhook URLs are re-validated on a schedule against the SSRF allowlist; newly disallowed targets are disabled and logged. |
| GDPR right-to-erasure implementation | TODO | @backend-owner | Erasure requests remove or anonymize all personal data across stores; audit trail retained; tests cover end-to-end erasure. |
| JWT secret rotation schedule | TODO | @backend-owner | Documented rotation schedule with overlapping validity window; rotation runbook exists and has been exercised. |

### Frontend

| Item | Status | Owner | Acceptance criteria |
| --- | --- | --- | --- |
| Cookie consent gate for analytics | TODO | @frontend-owner | Analytics load only after explicit consent; no tracking cookies set pre-consent; verified in browser. |
| Performance budget CI gate | TODO | @frontend-owner | CI fails when bundle size or key web-vitals exceed the documented budget. |
| Claim filing accessibility audit | TODO | @frontend-owner | Claim filing flow passes WCAG 2.1 AA audit; findings resolved or tracked with owners. |
| CSP allowlist audit and tighten | TODO | @frontend-owner | CSP allowlist reviewed; unused origins removed; policy enforced in production. |

### Ops

| Item | Status | Owner | Acceptance criteria |
| --- | --- | --- | --- |
| Contract E2E smoke tests on testnet | TODO | @ops-owner | Smoke suite runs against testnet in CI and passes on the release candidate. |
| gitleaks pre-commit hook installed | TODO | @ops-owner | gitleaks hook is installed and documented; a seeded secret is caught locally. |
| IPFS gateway allowlist enforcement | TODO | @ops-owner | Only allowlisted IPFS gateways are used; non-allowlisted gateways are rejected and logged. |
| Cargo audit exceptions reviewed | TODO | @ops-owner | Every `cargo audit` exception is reviewed, justified, and has an expiry date. |
| DR drill completed and documented | TODO | @ops-owner | DR drill executed per `docs/ops/disaster-recovery-runbook.md`; results documented with RTO/RPO measured. |
| Contract upgrade rollback procedure documented | TODO | @ops-owner | Rollback procedure documented and reviewed; steps verified in a dry run. |
