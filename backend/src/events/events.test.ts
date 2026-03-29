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
  PolicyInitiatedEvent,
  PolicyRenewedEvent,
  PolicyTerminatedEvent,
  PremiumTableUpdatedEvent,
  AssetAllowlistedEvent,
  AdminProposedEvent,
  TokenUpdatedEvent,
  PauseToggledEvent,
  DrainedEvent,
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
