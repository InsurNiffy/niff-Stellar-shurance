/**
 * Parser registry — mixed-version event stream tests.
 *
 * Verifies that selectParser() routes events to the correct versioned parser
 * based on the deployment registry, and that unknown schemas produce WarningRows.
 */

import {
  selectParser,
  initDeploymentRegistry,
  isWarningRow,
  EventParserV1,
  EventParserV2,
} from '../events/parser-registry';
import { SCHEMA_VERSION } from '../events/events.schema';

const CONTRACT_V1 = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
const CONTRACT_V2 = 'CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBSC4';
const TX = 'deadbeef';

beforeEach(() => {
  // Reset registry before each test
  initDeploymentRegistry([]);
});

describe('selectParser — deployment registry routing', () => {
  it('returns V1 parser for ledgers in V1 range', () => {
    initDeploymentRegistry([
      { contractId: CONTRACT_V1, schemaVersion: 1, fromLedger: 0, toLedger: 1000 },
      { contractId: CONTRACT_V1, schemaVersion: 2, fromLedger: 1000 },
    ]);

    const parser = selectParser(CONTRACT_V1, 500);
    expect(parser.schemaVersion).toBe(1);
  });

  it('returns V2 parser for ledgers in V2 range', () => {
    initDeploymentRegistry([
      { contractId: CONTRACT_V1, schemaVersion: 1, fromLedger: 0, toLedger: 1000 },
      { contractId: CONTRACT_V1, schemaVersion: 2, fromLedger: 1000 },
    ]);

    const parser = selectParser(CONTRACT_V1, 1500);
    expect(parser.schemaVersion).toBe(2);
  });

  it('boundary: ledger exactly at toLedger uses next range', () => {
    initDeploymentRegistry([
      { contractId: CONTRACT_V1, schemaVersion: 1, fromLedger: 0, toLedger: 1000 },
      { contractId: CONTRACT_V1, schemaVersion: 2, fromLedger: 1000 },
    ]);

    // toLedger is exclusive, so ledger 1000 should use V2
    const parser = selectParser(CONTRACT_V1, 1000);
    expect(parser.schemaVersion).toBe(2);
  });

  it('falls back to V1 when no deployment entry matches', () => {
    initDeploymentRegistry([]);
    const parser = selectParser(CONTRACT_V1, 999);
    expect(parser.schemaVersion).toBe(1);
  });

  it('isolates different contractIds — V2 contract does not affect V1 contract routing', () => {
    initDeploymentRegistry([
      { contractId: CONTRACT_V1, schemaVersion: 1, fromLedger: 0 },
      { contractId: CONTRACT_V2, schemaVersion: 2, fromLedger: 0 },
    ]);

    expect(selectParser(CONTRACT_V1, 500).schemaVersion).toBe(1);
    expect(selectParser(CONTRACT_V2, 500).schemaVersion).toBe(2);
  });
});

describe('mixed-version event stream parsing', () => {
  const v1Topics = ['niffyins', 'clm_filed', 1n, 'GABC1111111111111111111111111111111111111111111111111111'];
  const v1Payload = {
    version: SCHEMA_VERSION,
    policy_id: 3,
    amount: '5000000',
    evidence_hashes: [],
    filed_at: 100,
  };

  it('V1 parser correctly parses a V1 event', () => {
    initDeploymentRegistry([{ contractId: CONTRACT_V1, schemaVersion: 1, fromLedger: 0 }]);

    const parser = selectParser(CONTRACT_V1, 100);
    const result = parser.parse(v1Topics, v1Payload, 100, TX);

    expect(isWarningRow(result)).toBe(false);
    if (!isWarningRow(result)) {
      expect(result.key).toBe('niffyins:clm_filed');
      expect(result.schemaVersion).toBe(SCHEMA_VERSION);
    }
  });

  it('V2 parser delegates to V1 for known events (migration stub)', () => {
    initDeploymentRegistry([
      { contractId: CONTRACT_V1, schemaVersion: 1, fromLedger: 0, toLedger: 500 },
      { contractId: CONTRACT_V1, schemaVersion: 2, fromLedger: 500 },
    ]);

    const parser = selectParser(CONTRACT_V1, 600);
    expect(parser.schemaVersion).toBe(2);

    const result = parser.parse(v1Topics, v1Payload, 600, TX);
    expect(isWarningRow(result)).toBe(false);
    if (!isWarningRow(result)) {
      expect(result.key).toBe('niffyins:clm_filed');
    }
  });

  it('unknown event key produces a WarningRow (observable warning)', () => {
    const parser = new EventParserV1();
    const result = parser.parse(['niffyins', 'unknown_event_xyz'], {}, 100, TX);

    expect(isWarningRow(result)).toBe(true);
    if (isWarningRow(result)) {
      expect(result.kind).toBe('unknown_schema');
      expect(result.reason).toContain('unknown_event_key');
    }
  });

  it('topics shorter than 2 produce a WarningRow', () => {
    const parser = new EventParserV1();
    const result = parser.parse(['niffyins'], {}, 100, TX);

    expect(isWarningRow(result)).toBe(true);
    if (isWarningRow(result)) {
      expect(result.reason).toBe('topics_too_short');
    }
  });

  it('mixed stream: V1 events before upgrade and V2 events after parse correctly', () => {
    initDeploymentRegistry([
      { contractId: CONTRACT_V1, schemaVersion: 1, fromLedger: 0, toLedger: 1000 },
      { contractId: CONTRACT_V1, schemaVersion: 2, fromLedger: 1000 },
    ]);

    // Pre-upgrade event (ledger 500, V1 parser)
    const preParser = selectParser(CONTRACT_V1, 500);
    const preResult = preParser.parse(v1Topics, v1Payload, 500, TX);
    expect(isWarningRow(preResult)).toBe(false);

    // Post-upgrade event (ledger 1500, V2 parser — delegates to V1 for known events)
    const postParser = selectParser(CONTRACT_V1, 1500);
    const postResult = postParser.parse(v1Topics, v1Payload, 1500, TX);
    expect(isWarningRow(postResult)).toBe(false);
  });

  it('new parser versions can be added without modifying existing parser code', () => {
    // Verify V1 and V2 are independent instances
    const v1 = new EventParserV1();
    const v2 = new EventParserV2();
    expect(v1.schemaVersion).toBe(1);
    expect(v2.schemaVersion).toBe(2);
    // V1 parse result is unaffected by V2 existence
    const r = v1.parse(v1Topics, v1Payload, 100, TX);
    expect(isWarningRow(r)).toBe(false);
  });
});
