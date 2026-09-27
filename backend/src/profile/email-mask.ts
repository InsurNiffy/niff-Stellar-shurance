/**
 * Email masking for audit logs (#1485).
 *
 * `alice@example.com` → `a***@example.com` — keeps enough for operators to
 * correlate accounts without storing the readable address in the audit trail.
 */
export function maskEmail(email: string | null | undefined): string | null {
  if (email === null || email === undefined || email === '') return null;
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length === 1) return `*@${domain}`;
  return `${local.slice(0, 1)}***@${domain}`;
}
