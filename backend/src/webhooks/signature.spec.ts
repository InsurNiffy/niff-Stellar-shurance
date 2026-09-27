import { createHmac } from 'node:crypto';
import {
  computeHmac,
  parseSignatureHeader,
  signPayload,
  signRawBody,
  SIGNATURE_HEADER,
  TIMESTAMP_TOLERANCE_SECONDS,
  verifySignature,
} from './signature';

const SECRET = 'whsec_test_secret_0123456789';
const BODY = JSON.stringify({ event: 'claim.finalized', claimId: 42 });
const TS = 1_700_000_000;

describe('X-Niffy-Signature HMAC signing (#1484)', () => {
  it('exports the documented header name and 5-minute tolerance', () => {
    expect(SIGNATURE_HEADER).toBe('X-Niffy-Signature');
    expect(TIMESTAMP_TOLERANCE_SECONDS).toBe(300);
  });

  it('produces t=<ts>,v1=<hex hmac-sha256> over `${t}.${body}`', () => {
    const header = signRawBody(SECRET, BODY, TS);
    const expected = createHmac('sha256', SECRET).update(`${TS}.${BODY}`).digest('hex');
    expect(header).toBe(`t=${TS},v1=${expected}`);
  });

  it('parses the header into timestamp + signatures', () => {
    const parsed = parseSignatureHeader(signPayload(SECRET, { a: 1 }, TS));
    expect(parsed).not.toBeNull();
    expect(parsed?.timestamp).toBe(TS);
    expect(parsed?.signatures[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verification example: partner recomputes the signature from raw body', () => {
    const header = signPayload(SECRET, { event: 'claim.paid', claimId: 7 }, TS);
    const rawBody = JSON.stringify({ event: 'claim.paid', claimId: 7 });

    const result = verifySignature(header, rawBody, SECRET, { nowSeconds: TS + 10 });
    expect(result).toEqual({ ok: true, timestamp: TS });
  });

  it('accepts a rotated secret list (new + old)', () => {
    const header = signRawBody('new-secret-0123456789', BODY, TS);
    expect(verifySignature(header, BODY, ['new-secret-0123456789', SECRET], { nowSeconds: TS }).ok).toBe(true);
    expect(verifySignature(header, BODY, [SECRET], { nowSeconds: TS }).ok).toBe(false);
  });

  it('rejects tampered payloads', () => {
    const header = signRawBody(SECRET, BODY, TS);
    const tampered = BODY.replace('42', '43');
    expect(verifySignature(header, tampered, SECRET, { nowSeconds: TS })).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('rejects the wrong secret', () => {
    const header = signRawBody(SECRET, BODY, TS);
    expect(verifySignature(header, BODY, 'other-secret-0123456789', { nowSeconds: TS })).toEqual(
      { ok: false, reason: 'mismatch' },
    );
  });

  describe('replay protection (5-minute tolerance)', () => {
    it('rejects timestamps older than the tolerance', () => {
      const header = signRawBody(SECRET, BODY, TS);
      const result = verifySignature(header, BODY, SECRET, {
        nowSeconds: TS + TIMESTAMP_TOLERANCE_SECONDS + 1,
      });
      expect(result).toEqual({ ok: false, reason: 'stale' });
    });

    it('rejects timestamps too far in the future', () => {
      const header = signRawBody(SECRET, BODY, TS);
      const result = verifySignature(header, BODY, SECRET, {
        nowSeconds: TS - TIMESTAMP_TOLERANCE_SECONDS - 1,
      });
      expect(result).toEqual({ ok: false, reason: 'stale' });
    });

    it('accepts timestamps exactly on the tolerance boundary', () => {
      const header = signRawBody(SECRET, BODY, TS);
      expect(
        verifySignature(header, BODY, SECRET, { nowSeconds: TS + TIMESTAMP_TOLERANCE_SECONDS }).ok,
      ).toBe(true);
      expect(
        verifySignature(header, BODY, SECRET, { nowSeconds: TS - TIMESTAMP_TOLERANCE_SECONDS }).ok,
      ).toBe(true);
    });

    it('cannot be replayed with a fresh timestamp (signature binds t)', () => {
      const oldHeader = signRawBody(SECRET, BODY, TS);
      const now = TS + 600;
      expect(verifySignature(oldHeader, BODY, SECRET, { nowSeconds: now }).ok).toBe(false);

      // Replaying with an updated t but the old v1 fails the HMAC.
      const replayed = oldHeader.replace(`t=${TS}`, `t=${now}`);
      expect(verifySignature(replayed, BODY, SECRET, { nowSeconds: now })).toEqual({
        ok: false,
        reason: 'mismatch',
      });
    });
  });

  it('rejects missing and malformed headers', () => {
    expect(verifySignature(undefined, BODY, SECRET)).toEqual({ ok: false, reason: 'missing' });
    expect(verifySignature('', BODY, SECRET)).toEqual({ ok: false, reason: 'missing' });
    expect(verifySignature('garbage', BODY, SECRET)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifySignature('t=abc,v1=zz', BODY, SECRET)).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(verifySignature('v1=' + 'a'.repeat(64), BODY, SECRET)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('computeHmac exposes the raw digest helper used in docs examples', () => {
    expect(computeHmac(SECRET, 'x')).toBe(
      createHmac('sha256', SECRET).update('x').digest('hex'),
    );
  });
});
