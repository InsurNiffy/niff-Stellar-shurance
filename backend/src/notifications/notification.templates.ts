/**
 * Notification message templates.
 *
 * PII minimisation:
 *   - Only claim_id, policy_id, and outcome are included.
 *   - Claimant public key is shortened to first 8 + last 4 chars for display.
 *   - No evidence details, image URLs, vote counts, or medical information.
 *
 * Legal/compliance: all templates include an unsubscribe instruction for email.
 * Ensure messaging content is reviewed by legal before sending to real users.
 */

import type { ClaimFinalizedEvent } from './notification.types';

function shortKey(publicKey: string): string {
  return `${publicKey.slice(0, 8)}...${publicKey.slice(-4)}`;
}

export interface EmailTemplate {
  subject: string;
  text: string;
  html: string;
}

export function buildClaimFinalizedEmail(
  event: ClaimFinalizedEvent,
): EmailTemplate {
  const { claimId, policyId, claimantPublicKey, outcome, finalizedAt } = event;
  const key = shortKey(claimantPublicKey);
  const outcomeLabel = outcome === 'Approved' ? 'APPROVED' : 'REJECTED';
  const date = new Date(finalizedAt).toUTCString();

  const subject = `NiffyInsure Claim #${claimId} — ${outcomeLabel}`;

  const text = [
    `Hello ${key},`,
    '',
    `Your insurance claim has been finalized.`,
    '',
    `  Claim ID:  ${claimId}`,
    `  Policy ID: ${policyId}`,
    `  Outcome:   ${outcomeLabel}`,
    `  Date:      ${date}`,
    '',
    outcome === 'Approved'
      ? 'Your claim has been approved. Payout will be processed on-chain shortly.'
      : 'Your claim has been rejected. If you believe this is incorrect, you may open a new claim with updated evidence.',
    '',
    '──────────────────────────────────────────────',
    'This notification was sent because you have an active NiffyInsure policy.',
    'To unsubscribe from claim notifications, update your preferences at:',
    '  /notifications/preferences',
    '',
    'NiffyInsure — decentralised parametric insurance on Stellar',
  ].join('\n');

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${subject}</title></head>
<body style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px">
  <h2 style="color:${outcome === 'Approved' ? '#16a34a' : '#dc2626'}">
    Claim ${outcomeLabel}
  </h2>
  <table style="border-collapse:collapse;width:100%">
    <tr><td style="padding:6px 0;color:#6b7280">Claim ID</td><td>${claimId}</td></tr>
    <tr><td style="padding:6px 0;color:#6b7280">Policy ID</td><td>${policyId}</td></tr>
    <tr><td style="padding:6px 0;color:#6b7280">Account</td><td>${key}</td></tr>
    <tr><td style="padding:6px 0;color:#6b7280">Date</td><td>${date}</td></tr>
  </table>
  <p style="margin-top:16px">
    ${
      outcome === 'Approved'
        ? 'Your claim has been <strong>approved</strong>. Payout will be processed on-chain shortly.'
        : 'Your claim has been <strong>rejected</strong>. If you believe this is incorrect, you may open a new claim with updated evidence.'
    }
  </p>
  <hr style="margin-top:32px;border:none;border-top:1px solid #e5e7eb"/>
  <p style="font-size:12px;color:#9ca3af">
    This notification was sent because you have an active NiffyInsure policy.<br>
    To unsubscribe, update your preferences at <code>/notifications/preferences</code>.
  </p>
</body>
</html>`.trim();

  return { subject, text, html };
}

export function buildClaimFinalizedDiscord(event: ClaimFinalizedEvent): string {
  const { claimId, policyId, outcome } = event;
  const emoji = outcome === 'Approved' ? '✅' : '❌';
  return (
    `**NiffyInsure** — Claim Update\n` +
    `${emoji} Claim **#${claimId}** (Policy ${policyId}) has been **${outcome.toUpperCase()}**.\n` +
    `_Update your preferences with \`/notifications/preferences\` to unsubscribe._`
  );
}

export function buildClaimFinalizedTelegram(event: ClaimFinalizedEvent): string {
  const { claimId, policyId, outcome } = event;
  const emoji = outcome === 'Approved' ? '✅' : '❌';
  return (
    `${emoji} <b>NiffyInsure Claim Update</b>\n` +
    `Claim #${claimId} (Policy ${policyId}): <b>${outcome.toUpperCase()}</b>\n` +
    `<i>Reply /unsubscribe to stop notifications.</i>`
  );
}
