/**
 * Notification service tests.
 *
 * Uses a mock nodemailer transport so no real emails are sent.
 * Verifies: successful send, retry behaviour, opt-out, and idempotency.
 */

import type { ClaimFinalizedEvent } from './notification.types';
import {
  sendClaimNotifications,
  getPreferences,
  updatePreferences,
  _setTransportForTests,
  _clearSentSetForTests,
} from './notification.service';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CLAIMANT = 'GDVOEGATQV4FGUJKDEBEYT5NAPWJ55MEMJVLC5TU7Y74WD73PPAS4TYW';

const EVENT: ClaimFinalizedEvent = {
  claimId: '42',
  policyId: 1,
  claimantPublicKey: CLAIMANT,
  outcome: 'Approved',
  finalizedAt: new Date().toISOString(),
};

// ── Mock transport ────────────────────────────────────────────────────────────

function makeMockTransport(shouldFail = false) {
  const sent: unknown[] = [];
  return {
    sent,
    transport: {
      sendMail: jest.fn(async (opts: unknown) => {
        if (shouldFail) throw new Error('SMTP connection refused');
        sent.push(opts);
      }),
    } as never,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _clearSentSetForTests();
});

describe('sendClaimNotifications', () => {
  describe('email opt-in — successful send', () => {
    it('sends email when user is opted in with an address', async () => {
      const { sent, transport } = makeMockTransport();
      _setTransportForTests(transport);

      updatePreferences({
        claimantPublicKey: CLAIMANT,
        emailEnabled: true,
        email: 'alice@example.com',
        discordEnabled: false,
        telegramEnabled: false,
      });

      const result = await sendClaimNotifications(EVENT);

      const emailRecord = result.records.find((r) => r.channel === 'email');
      expect(emailRecord?.status).toBe('sent');
      expect(sent).toHaveLength(1);
    });
  });

  describe('email opt-out', () => {
    it('skips email when emailEnabled is false', async () => {
      const { sent, transport } = makeMockTransport();
      _setTransportForTests(transport);

      updatePreferences({
        claimantPublicKey: CLAIMANT,
        emailEnabled: false,
        discordEnabled: false,
        telegramEnabled: false,
      });

      const result = await sendClaimNotifications(EVENT);

      const emailRecord = result.records.find((r) => r.channel === 'email');
      expect(emailRecord?.status).toBe('skipped');
      expect(sent).toHaveLength(0);
    });
  });

  describe('idempotency', () => {
    it('does not send a second email for the same (claimant, claimId)', async () => {
      const { sent, transport } = makeMockTransport();
      _setTransportForTests(transport);

      updatePreferences({
        claimantPublicKey: CLAIMANT,
        emailEnabled: true,
        email: 'alice@example.com',
        discordEnabled: false,
        telegramEnabled: false,
      });

      await sendClaimNotifications(EVENT);
      const firstCount = sent.length;

      // Second call with the same event — must be skipped
      await sendClaimNotifications(EVENT);

      expect(sent).toHaveLength(firstCount); // no additional sends
      const records = (await sendClaimNotifications(EVENT)).records;
      const emailRecord = records.find((r) => r.channel === 'email');
      expect(emailRecord?.status).toBe('skipped');
    });
  });

  describe('retry on failure', () => {
    it('marks the record as failed after all retries are exhausted', async () => {
      const { transport } = makeMockTransport(true);
      _setTransportForTests(transport);

      updatePreferences({
        claimantPublicKey: CLAIMANT,
        emailEnabled: true,
        email: 'alice@example.com',
        discordEnabled: false,
        telegramEnabled: false,
      });

      const result = await sendClaimNotifications(EVENT);

      const emailRecord = result.records.find((r) => r.channel === 'email');
      expect(emailRecord?.status).toBe('failed');
      expect(emailRecord?.error).toContain('SMTP');
    }, 10_000);
  });

  describe('no email address configured', () => {
    it('skips email even when emailEnabled is true but no email is set', async () => {
      const { sent, transport } = makeMockTransport();
      _setTransportForTests(transport);

      updatePreferences({
        claimantPublicKey: CLAIMANT,
        emailEnabled: true,
        // email not set
        discordEnabled: false,
        telegramEnabled: false,
      });

      const result = await sendClaimNotifications(EVENT);

      const emailRecord = result.records.find((r) => r.channel === 'email');
      expect(emailRecord?.status).toBe('skipped');
      expect(sent).toHaveLength(0);
    });
  });

  describe('default preferences', () => {
    it('returns opt-in defaults when preferences have never been set', () => {
      const prefs = getPreferences('GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ');
      expect(prefs.emailEnabled).toBe(true);
      expect(prefs.discordEnabled).toBe(false);
      expect(prefs.telegramEnabled).toBe(false);
    });
  });
});
