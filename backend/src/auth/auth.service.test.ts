/**
 * Auth service unit tests.
 *
 * These tests use an in-memory nonce store and a real Ed25519 keypair generated
 * by stellar-sdk — no network calls, no Redis required.
 */

import { Keypair } from '@stellar/stellar-sdk';
import { generateChallenge, verifyChallenge } from './auth.service';
import { _setNonceStoreForTests, NonceStore } from './nonce.store';

// ── In-memory store fixture ────────────────────────────────────────────────────

function makeMemoryStore(): NonceStore {
  const map = new Map<string, { data: string; expiresAt: number }>();
  return {
    async set(nonce, data, ttlSeconds) {
      map.set(nonce, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    async get(nonce) {
      const entry = map.get(nonce);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        map.delete(nonce);
        return null;
      }
      return entry.data;
    },
    async del(nonce) {
      map.delete(nonce);
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sign(keypair: Keypair, message: string): string {
  return keypair.sign(Buffer.from(message)).toString('base64');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('auth.service', () => {
  let keypair: Keypair;
  let store: NonceStore;

  beforeEach(() => {
    keypair = Keypair.random();
    store = makeMemoryStore();
    _setNonceStoreForTests(store);
  });

  describe('generateChallenge', () => {
    it('returns nonce, message, and expiresAt', async () => {
      const result = await generateChallenge(keypair.publicKey());
      expect(result.nonce).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(result.message).toContain(keypair.publicKey());
      expect(result.message).toContain(`Nonce: ${result.nonce}`);
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('rejects an invalid public key', async () => {
      await expect(generateChallenge('not-a-key')).rejects.toMatchObject({
        code: 'INVALID_PUBLIC_KEY',
        statusCode: 400,
      });
    });
  });

  describe('verifyChallenge — happy path', () => {
    it('issues a JWT for a valid signature', async () => {
      const { nonce, message } = await generateChallenge(keypair.publicKey());
      const sig = sign(keypair, message);
      const { token, expiresAt } = await verifyChallenge(
        keypair.publicKey(),
        nonce,
        sig,
      );
      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3); // JWT structure
      expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('verifyChallenge — replay attack', () => {
    it('rejects a nonce that has already been used', async () => {
      const { nonce, message } = await generateChallenge(keypair.publicKey());
      const sig = sign(keypair, message);

      // First use succeeds
      await verifyChallenge(keypair.publicKey(), nonce, sig);

      // Second use with the same nonce must fail
      await expect(
        verifyChallenge(keypair.publicKey(), nonce, sig),
      ).rejects.toMatchObject({ code: 'NONCE_EXPIRED_OR_USED', statusCode: 401 });
    });
  });

  describe('verifyChallenge — expired nonce', () => {
    it('rejects an expired nonce from the store', async () => {
      // Manually insert an already-expired entry
      await store.set('expired-nonce', JSON.stringify({ publicKey: keypair.publicKey(), message: 'msg', issuedAt: '' }), 0);
      // TTL=0 means it expires immediately

      // Small delay to ensure expiry
      await new Promise((r) => setTimeout(r, 10));

      await expect(
        verifyChallenge(keypair.publicKey(), 'expired-nonce', 'AAAA'),
      ).rejects.toMatchObject({ code: 'NONCE_EXPIRED_OR_USED', statusCode: 401 });
    });
  });

  describe('verifyChallenge — wrong key', () => {
    it('rejects a signature from a different keypair', async () => {
      const { nonce, message } = await generateChallenge(keypair.publicKey());
      const attacker = Keypair.random();
      const badSig = sign(attacker, message);

      await expect(
        verifyChallenge(keypair.publicKey(), nonce, badSig),
      ).rejects.toMatchObject({ code: 'INVALID_SIGNATURE', statusCode: 401 });
    });
  });

  describe('verifyChallenge — signature tampering', () => {
    it('rejects a signature over a different message', async () => {
      const { nonce } = await generateChallenge(keypair.publicKey());
      const tampered = sign(keypair, 'tampered message');

      await expect(
        verifyChallenge(keypair.publicKey(), nonce, tampered),
      ).rejects.toMatchObject({ code: 'INVALID_SIGNATURE', statusCode: 401 });
    });
  });

  describe('verifyChallenge — key mismatch', () => {
    it('rejects when publicKey differs from the one used to request the challenge', async () => {
      const { nonce, message } = await generateChallenge(keypair.publicKey());
      const other = Keypair.random();
      const sig = sign(other, message);

      await expect(
        verifyChallenge(other.publicKey(), nonce, sig),
      ).rejects.toMatchObject({ code: 'KEY_MISMATCH', statusCode: 401 });
    });
  });
});
