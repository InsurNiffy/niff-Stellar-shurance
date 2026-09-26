/**
 * Event schema regression tests.
 *
 * These tests assert that parseEvent() correctly routes and types every
 * event in the catalog. If a field is renamed or a topic layout changes,
 * the test fails CI intentionally — treat it as a semver-major signal
 * requiring a SCHEMA_VERSION bump and a new parser entry.
 *
 * Payload fixtures are derived from the JSON examples in events.rs doc-comments.
 */

import {
  parseEvent,
  SCHEMA_VERSION,
  ClaimFiledEvent,
  VoteCastEvent,
  ClaimFinalizedEvent,
  ClaimPaidEvent,
  ClaimStatusChangedEvent,
  AppealOpenedEvent,
  AppealResolvedEvent,
  PolicyInitiatedEvent,
  PolicyRenewedEvent,
  PolicyTerminatedEvent,
  PremiumTableUpdatedEvent,
  AssetAllowlistedEvent,
  AdminProposedEvent,
  TokenUpdatedEvent,
  PauseToggledEvent,
  DrainedEvent,
  PayoutAssetOverrideAppliedEvent,
  AssetPremiumTableSetEvent,
  InstallmentDisbursedEvent,
  ClaimFullyPaidEvent,
  PolicyTransferredEvent,
  ClaimEvidenceUpdatedEvent,
  PayoutRecipientWarningEvent,
} from '../events/events.schema';

const LEDGER = 1_234_567;
const TX = '0xdeadbeef';
const HOLDER = 'GABC1111111111111111111111111111111111111111111111111111';
const ASSET = 'CABC2222222222222222222222222222222222222222222222222222';
const ADMIN = 'GABC3333333333333333333333333333333333333333333333333333';

// ── Claim events ──────────────────────────────────────────────────────────────

describe('clm_filed', () => {
  const topics = ['niffyins', 'clm_filed', 1n, HOLDER];
  const payload: ClaimFiledEvent = {
    version: SCHEMA_VERSION,
    policy_id: 3,
    amount: '5000000',
    evidence_hashes: [
      '0100000000000000000000000000000000000000000000000000000000000000',
    ],
    filed_at: LEDGER,
  };

  it('routes to correct key', () => {
    const ev = parseEvent(topics, payload, LEDGER, TX);
    expect(ev?.key).toBe('niffyins:clm_filed');
  });

  it('exposes claim_id and holder as ids', () => {
    const ev = parseEvent(topics, payload, LEDGER, TX);
    expect(ev?.ids[0]).toBe(1n);
    expect(ev?.ids[1]).toBe(HOLDER);
  });

  it('preserves all payload fields', () => {
    const ev = parseEvent(topics, payload, LEDGER, TX);
    const p = ev?.payload as ClaimFiledEvent;
    expect(p.version).toBe(SCHEMA_VERSION);
    expect(p.policy_id).toBe(3);
    expect(p.amount).toBe('5000000');
    expect(p.evidence_hashes).toEqual([
      '0100000000000000000000000000000000000000000000000000000000000000',
    ]);
    expect(p.filed_at).toBe(LEDGER);
  });
});

describe('vote_cast', () => {
  const topics = ['niffyins', 'vote_cast', 1n, HOLDER];
  const payload: VoteCastEvent = {
    version: SCHEMA_VERSION,
    vote: 'Approve',
    approve_votes: 2,
    reject_votes: 1,
    at_ledger: LEDGER,
  };

  it('routes and preserves vote tallies', () => {
    const ev = parseEvent(topics, payload, LEDGER, TX);
    expect(ev?.key).toBe('niffyins:vote_cast');
    const p = ev?.payload as VoteCastEvent;
    expect(p.vote).toBe('Approve');
    expect(p.approve_votes).toBe(2);
    expect(p.reject_votes).toBe(1);
  });
});

describe('clm_final', () => {
  const topics = ['niffyins', 'clm_final', 1n];

  it('Approved status', () => {
    const payload: ClaimFinalizedEvent = {
      version: SCHEMA_VERSION,
      status: 'Approved',
      approve_votes: 3,
      reject_votes: 1,
      at_ledger: LEDGER,
    };
    const ev = parseEvent(topics, payload, LEDGER, TX);
    expect(ev?.key).toBe('niffyins:clm_final');
    expect((ev?.payload as ClaimFinalizedEvent).status).toBe('Approved');
  });

  it('Rejected status', () => {
    const payload: ClaimFinalizedEvent = {
      version: SCHEMA_VERSION,
      status: 'Rejected',
      approve_votes: 0,
      reject_votes: 0,
      at_ledger: LEDGER,
    };
    const ev = parseEvent(topics, payload, LEDGER, TX);
    expect((ev?.payload as ClaimFinalizedEvent).status).toBe('Rejected');
  });
});

describe('clm_paid', () => {
  const topics = ['niffyins', 'clm_paid', 1n];
  const payload: ClaimPaidEvent = {
    version: SCHEMA_VERSION,
    recipient: HOLDER,
    amount: '5000000',
    asset: ASSET,
    at_ledger: LEDGER,
  };

  it('routes and preserves payout fields', () => {
    const ev = parseEvent(topics, payload, LEDGER, TX);
    expect(ev?.key).toBe('niffyins:clm_paid');
    const p = ev?.payload as ClaimPaidEvent;
    expect(p.recipient).toBe(HOLDER);
    expect(p.amount).toBe('5000000');
    expect(p.asset).toBe(ASSET);
  });
});

// ── Policy lifecycle events ───────────────────────────────────────────────────

describe('PolicyInitiated', () => {
  const topics = ['niffyinsure', 'PolicyInitiated', HOLDER];
  const payload: PolicyInitiatedEvent = {
    version: SCHEMA_VERSION,
    policy_id: 1,
    premium: '500000',
    asset: ASSET,
    policy_type: 'Auto',
    region: 'Medium',
    coverage: '50000000',
    start_ledger: LEDGER,
    end_ledger: LEDGER + 1_051_200,
  };

  it('routes correctly', () => {
    const ev = parseEvent(topics, payload, LEDGER, TX);
    expect(ev?.key).toBe('niffyinsure:PolicyInitiated');
  });

  it('holder is in ids', () => {
    const ev = parseEvent(topics, payload, LEDGER, TX);
    expect(ev?.ids[0]).toBe(HOLDER);
  });

  it('preserves all fields', () => {
    const ev = parseEvent(topics, payload, LEDGER, TX);
    const p = ev?.payload as PolicyInitiatedEvent;
    expect(p.policy_id).toBe(1);
    expect(p.premium).toBe('500000');
    expect(p.policy_type).toBe('Auto');
    expect(p.region).toBe('Medium');
    expect(p.coverage).toBe('50000000');
  });
});

describe('PolicyRenewed', () => {
  const topics = ['niffyinsure', 'PolicyRenewed', HOLDER];
  const payload: PolicyRenewedEvent = {
    version: SCHEMA_VERSION,
    policy_id: 1,
    premium: '500000',
    new_end_ledger: LEDGER + 2_102_400,
  };

  it('routes and preserves new_end_ledger', () => {
    const ev = parseEvent(topics, payload, LEDGER, TX);
    expect(ev?.key).toBe('niffyinsure:PolicyRenewed');
    expect((ev?.payload as PolicyRenewedEvent).new_end_ledger).toBe(LEDGER + 2_102_400);
  });
});

describe('PolicyTerminated', () => {
  const topics = ['niffyinsure', 'policy_terminated', HOLDER, 1];
  const payload: PolicyTerminatedEvent = {
    reason_code: 1,
    terminated_by_admin: 0,
    open_claim_bypass: 0,
    open_claims: 0,
    at_ledger: LEDGER,
  };

  it('routes and exposes holder + policy_id as ids', () => {
    const ev = parseEvent(topics, payload, LEDGER, TX);
    expect(ev?.key).toBe('niffyinsure:policy_terminated');
    expect(ev?.ids[0]).toBe(HOLDER);
    expect(ev?.ids[1]).toBe(1);
  });
});

// ── Admin / config events ─────────────────────────────────────────────────────

describe('tbl_upd', () => {
  it('routes and preserves table_version', () => {
    const payload: PremiumTableUpdatedEvent = { version: SCHEMA_VERSION, table_version: 2 };
    const ev = parseEvent(['niffyins', 'tbl_upd'], payload, LEDGER, TX);
    expect(ev?.key).toBe('niffyins:tbl_upd');
    expect((ev?.payload as PremiumTableUpdatedEvent).table_version).toBe(2);
  });
});

describe('asset_set', () => {
  it('allowed=1 (add)', () => {
    const payload: AssetAllowlistedEvent = { version: SCHEMA_VERSION, allowed: 1 };
    const ev = parseEvent(['niffyins', 'asset_set', ASSET], payload, LEDGER, TX);
    expect(ev?.key).toBe('niffyins:asset_set');
    expect((ev?.payload as AssetAllowlistedEvent).allowed).toBe(1);
  });

  it('allowed=0 (remove)', () => {
    const payload: AssetAllowlistedEvent = { version: SCHEMA_VERSION, allowed: 0 };
    const ev = parseEvent(['niffyins', 'asset_set', ASSET], payload, LEDGER, TX);
    expect((ev?.payload as AssetAllowlistedEvent).allowed).toBe(0);
  });
});

describe('adm_prop', () => {
  it('routes and exposes old/new admin as ids', () => {
    const payload: AdminProposedEvent = { version: SCHEMA_VERSION };
    const NEW_ADMIN = 'GABC4444444444444444444444444444444444444444444444444444';
    const ev = parseEvent(['niffyins', 'adm_prop', ADMIN, NEW_ADMIN], payload, LEDGER, TX);
    expect(ev?.key).toBe('niffyins:adm_prop');
    expect(ev?.ids[0]).toBe(ADMIN);
    expect(ev?.ids[1]).toBe(NEW_ADMIN);
  });
});

describe('adm_tok', () => {
  it('routes and preserves old/new token', () => {
    const NEW_TOKEN = 'CABC5555555555555555555555555555555555555555555555555555';
    const payload: TokenUpdatedEvent = {
      version: SCHEMA_VERSION,
      old_token: ASSET,
      new_token: NEW_TOKEN,
    };
    const ev = parseEvent(['niffyins', 'adm_tok'], payload, LEDGER, TX);
    expect(ev?.key).toBe('niffyins:adm_tok');
    const p = ev?.payload as TokenUpdatedEvent;
    expect(p.old_token).toBe(ASSET);
    expect(p.new_token).toBe(NEW_TOKEN);
  });
});

describe('adm_paus', () => {
  it('paused=1', () => {
    const payload: PauseToggledEvent = { version: SCHEMA_VERSION, paused: 1 };
    const ev = parseEvent(['niffyins', 'adm_paus', ADMIN], payload, LEDGER, TX);
    expect(ev?.key).toBe('niffyins:adm_paus');
    expect((ev?.payload as PauseToggledEvent).paused).toBe(1);
  });

  it('paused=0', () => {
    const payload: PauseToggledEvent = { version: SCHEMA_VERSION, paused: 0 };
    const ev = parseEvent(['niffyins', 'adm_paus', ADMIN], payload, LEDGER, TX);
    expect((ev?.payload as PauseToggledEvent).paused).toBe(0);
  });
});

describe('adm_drn', () => {
  it('routes and preserves amount', () => {
    const payload: DrainedEvent = {
      version: SCHEMA_VERSION,
      recipient: HOLDER,
      amount: '10000000',
    };
    const ev = parseEvent(['niffyins', 'adm_drn', ADMIN], payload, LEDGER, TX);
    expect(ev?.key).toBe('niffyins:adm_drn');
    expect((ev?.payload as DrainedEvent).amount).toBe('10000000');
  });
});

// ── Parser table integrity ────────────────────────────────────────────────────

describe('parseEvent', () => {
  it('returns null for unknown namespace', () => {
    expect(parseEvent(['unknown', 'clm_filed'], {}, LEDGER, TX)).toBeNull();
  });

  it('returns null for unknown event name', () => {
    expect(parseEvent(['niffyins', 'unknown_event'], {}, LEDGER, TX)).toBeNull();
  });

  it('returns null for unsupported schema version', () => {
    const payload = {
      version: 999,
      policy_id: 1,
      amount: '0',
      evidence_hashes: [],
      filed_at: 0,
    };
    expect(parseEvent(['niffyins', 'clm_filed', 1n, HOLDER], payload, LEDGER, TX)).toBeNull();
  });

  it('returns null for topics shorter than 2', () => {
    expect(parseEvent(['niffyins'], {}, LEDGER, TX)).toBeNull();
  });
});

// ── Additional events (Issue #1163) ──────────────────────────────────────────

describe('claim_status_changed', () => {
  const topics = ['niffyins', 'claim_status_changed', 1n];
  const payload: ClaimStatusChangedEvent = {
    version: SCHEMA_VERSION,
    old_status: 'Processing',
    new_status: 'Approved',
    at_ledger: LEDGER,
  };

  it('routes correctly', () => {
    const ev = parseEvent(topics, payload, LEDGER, TX);
    expect(ev?.key).toBe('niffyins:claim_status_changed');
  });

  it('preserves status fields', () => {
    const ev = parseEvent(topics, payload, LEDGER, TX);
    const p = ev?.payload as ClaimStatusChangedEvent;
    expect(p.old_status).toBe('Processing');
    expect(p.new_status).toBe('Approved');
    expect(p.at_ledger).toBe(LEDGER);
  });
});

// ── Appeal event sequence (#1318) ────────────────────────────────────────────

describe('appeal event sequence (AppealOpened → status → AppealResolved)', () => {
  const CLAIM_ID = 42n;

  const openedTopics = ['niffyinsure', 'appeal_opened', CLAIM_ID];
  const openedPayload: AppealOpenedEvent = {
    policy_id: 3,
    claimant: HOLDER,
    appeal_deadline_ledger: LEDGER + 100,
    quorum_bps: 7500,
    at_ledger: LEDGER,
  };

  const underAppealStatusTopics = ['niffyins', 'claim_status_changed', CLAIM_ID];
  const underAppealStatusPayload: ClaimStatusChangedEvent = {
    version: SCHEMA_VERSION,
    old_status: 'Rejected',
    new_status: 'UnderAppeal',
    at_ledger: LEDGER,
  };

  const approvedStatusPayload: ClaimStatusChangedEvent = {
    version: SCHEMA_VERSION,
    old_status: 'UnderAppeal',
    new_status: 'AppealApproved',
    at_ledger: LEDGER + 50,
  };

  const resolvedTopics = ['niffyinsure', 'appeal_resolved', CLAIM_ID];
  const resolvedPayload: AppealResolvedEvent = {
    policy_id: 3,
    claimant: HOLDER,
    outcome: 'AppealApproved',
    approve_votes: 5,
    reject_votes: 1,
    at_ledger: LEDGER + 50,
  };

  it('decodes AppealOpened', () => {
    const ev = parseEvent(openedTopics, openedPayload, LEDGER, TX);
    expect(ev?.key).toBe('niffyinsure:appeal_opened');
    expect(ev?.ids[0]).toBe(CLAIM_ID);
    const p = ev?.payload as AppealOpenedEvent;
    expect(p.appeal_deadline_ledger).toBe(LEDGER + 100);
    expect(p.quorum_bps).toBe(7500);
    expect(p.claimant).toBe(HOLDER);
  });

  it('decodes appeal-open ClaimStatusChanged (UnderAppeal)', () => {
    const ev = parseEvent(underAppealStatusTopics, underAppealStatusPayload, LEDGER, TX);
    expect(ev?.key).toBe('niffyins:claim_status_changed');
    const p = ev?.payload as ClaimStatusChangedEvent;
    expect(p.old_status).toBe('Rejected');
    expect(p.new_status).toBe('UnderAppeal');
  });

  it('decodes appeal-outcome ClaimStatusChanged (AppealApproved)', () => {
    const ev = parseEvent(underAppealStatusTopics, approvedStatusPayload, LEDGER + 50, TX);
    expect(ev?.key).toBe('niffyins:claim_status_changed');
    const p = ev?.payload as ClaimStatusChangedEvent;
    expect(p.new_status).toBe('AppealApproved');
  });

  it('decodes AppealResolved', () => {
    const ev = parseEvent(resolvedTopics, resolvedPayload, LEDGER + 50, TX);
    expect(ev?.key).toBe('niffyinsure:appeal_resolved');
    expect(ev?.ids[0]).toBe(CLAIM_ID);
    const p = ev?.payload as AppealResolvedEvent;
    expect(p.outcome).toBe('AppealApproved');
    expect(p.approve_votes).toBe(5);
    expect(p.reject_votes).toBe(1);
  });

  it('fixture sequence preserves claim_id across open → resolve', () => {
    const openEv = parseEvent(openedTopics, openedPayload, LEDGER, TX);
    const statusEv = parseEvent(underAppealStatusTopics, underAppealStatusPayload, LEDGER, TX);
    const resolveEv = parseEvent(resolvedTopics, resolvedPayload, LEDGER + 50, TX);
    expect(openEv?.ids[0]).toBe(CLAIM_ID);
    expect(statusEv?.ids[0]).toBe(CLAIM_ID);
    expect(resolveEv?.ids[0]).toBe(CLAIM_ID);
  });
});

describe('payout_asset_override_applied', () => {
  const NEW_ASSET = 'CABC9999999999999999999999999999999999999999999999999999';
  const topics = ['niffyinsure', 'payout_asset_override_applied', 1n];
  const payload: PayoutAssetOverrideAppliedEvent = {
    version: SCHEMA_VERSION,
    policy_type: 'Health',
    premium_asset: ASSET,
    payout_asset: NEW_ASSET,
  };

  it('routes correctly', () => {
    const ev = parseEvent(topics, payload, LEDGER, TX);
    expect(ev?.key).toBe('niffyinsure:payout_asset_override_applied');
  });

  it('preserves asset override fields', () => {
    const ev = parseEvent(topics, payload, LEDGER, TX);
    const p = ev?.payload as PayoutAssetOverrideAppliedEvent;
    expect(p.policy_type).toBe('Health');
    expect(p.premium_asset).toBe(ASSET);
    expect(p.payout_asset).toBe(NEW_ASSET);
  });
});

describe('asset_premium_table_set', () => {
  const topics = ['niffyinsure', 'asset_premium_table_set', ASSET];

  it('table stored (cleared=0)', () => {
    const payload: AssetPremiumTableSetEvent = {
      version: SCHEMA_VERSION,
      table_version: 3,
      cleared: 0,
    };
    const ev = parseEvent(topics, payload, LEDGER, TX);
    expect(ev?.key).toBe('niffyinsure:asset_premium_table_set');
    expect((ev?.payload as AssetPremiumTableSetEvent).cleared).toBe(0);
    expect((ev?.payload as AssetPremiumTableSetEvent).table_version).toBe(3);
  });

  it('table cleared (cleared=1)', () => {
    const payload: AssetPremiumTableSetEvent = {
      version: SCHEMA_VERSION,
      table_version: 0,
      cleared: 1,
    };
    const ev = parseEvent(topics, payload, LEDGER, TX);
    expect((ev?.payload as AssetPremiumTableSetEvent).cleared).toBe(1);
  });
});

describe('installment_disbursed', () => {
  const topics = ['niffyinsure', 'installment_disbursed', 1n];
  const payload: InstallmentDisbursedEvent = {
    version: SCHEMA_VERSION,
    recipient: HOLDER,
    amount: '1000000',
    paid_amount: '1000000',
    total_amount: '5000000',
    installment_count: 1,
    asset: ASSET,
    at_ledger: LEDGER,
  };

  it('routes correctly', () => {
    const ev = parseEvent(topics, payload, LEDGER, TX);
    expect(ev?.key).toBe('niffyinsure:installment_disbursed');
  });

  it('preserves installment fields', () => {
    const ev = parseEvent(topics, payload, LEDGER, TX);
    const p = ev?.payload as InstallmentDisbursedEvent;
    expect(p.amount).toBe('1000000');
    expect(p.paid_amount).toBe('1000000');
    expect(p.total_amount).toBe('5000000');
    expect(p.installment_count).toBe(1);
  });
});

describe('claim_fully_paid', () => {
  const topics = ['niffyinsure', 'claim_fully_paid', 1n];
  const payload: ClaimFullyPaidEvent = {
    version: SCHEMA_VERSION,
    recipient: HOLDER,
    total_paid: '5000000',
    installment_count: 3,
    at_ledger: LEDGER,
  };

  it('routes correctly', () => {
    const ev = parseEvent(topics, payload, LEDGER, TX);
    expect(ev?.key).toBe('niffyinsure:claim_fully_paid');
  });

  it('preserves total_paid and installment_count', () => {
    const ev = parseEvent(topics, payload, LEDGER, TX);
    const p = ev?.payload as ClaimFullyPaidEvent;
    expect(p.total_paid).toBe('5000000');
    expect(p.installment_count).toBe(3);
  });
});

describe('policy_transferred', () => {
  const NEW_HOLDER = 'GABC7777777777777777777777777777777777777777777777777777';
  const topics = ['niffyinsure', 'policy_transferred', 1, HOLDER, NEW_HOLDER];
  const payload: PolicyTransferredEvent = {
    version: SCHEMA_VERSION,
    at_ledger: LEDGER,
  };

  it('routes and exposes ids', () => {
    const ev = parseEvent(topics, payload, LEDGER, TX);
    expect(ev?.key).toBe('niffyinsure:policy_transferred');
    expect(ev?.ids[0]).toBe(1);
    expect(ev?.ids[1]).toBe(HOLDER);
    expect(ev?.ids[2]).toBe(NEW_HOLDER);
  });
});

describe('claim_evidence_updated', () => {
  const topics = ['niffyinsure', 'claim_evidence_updated', 1n];
  const payload: ClaimEvidenceUpdatedEvent = {
    policy_id: 3,
    evidence_hashes: ['0100000000000000000000000000000000000000000000000000000000000000'],
    at_ledger: LEDGER,
  };

  it('routes correctly', () => {
    const ev = parseEvent(topics, payload, LEDGER, TX);
    expect(ev?.key).toBe('niffyinsure:claim_evidence_updated');
  });

  it('preserves evidence_hashes', () => {
    const ev = parseEvent(topics, payload, LEDGER, TX);
    const p = ev?.payload as ClaimEvidenceUpdatedEvent;
    expect(p.evidence_hashes).toHaveLength(1);
    expect(p.policy_id).toBe(3);
  });
});

describe('payout_recipient_warning', () => {
  const topics = ['niffyinsure', 'payout_recipient_warning', 1n];
  const payload: PayoutRecipientWarningEvent = {
    recipient: HOLDER,
    asset: ASSET,
    at_ledger: LEDGER,
  };

  it('routes correctly', () => {
    const ev = parseEvent(topics, payload, LEDGER, TX);
    expect(ev?.key).toBe('niffyinsure:payout_recipient_warning');
  });

  it('preserves recipient and asset', () => {
    const ev = parseEvent(topics, payload, LEDGER, TX);
    const p = ev?.payload as PayoutRecipientWarningEvent;
    expect(p.recipient).toBe(HOLDER);
    expect(p.asset).toBe(ASSET);
  });
});
