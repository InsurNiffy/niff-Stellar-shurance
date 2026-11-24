import { StrKey } from '@stellar/stellar-sdk';

/**
 * Wallet address normalization utility.
 *
 * Canonicalises Stellar StrKeys so that the same account always resolves to
 * the same DB row regardless of the format it arrived in.
 *
 * Muxed accounts (M... addresses): we STRIP the mux ID and return the
 * underlying canonical G... account. Rationale: the mux ID is a routing hint
 * for a specific transaction, not an identity. Persisting the muxed form would
 * fragment balances/lookups across the same underlying account. Callers that
 * need the mux ID must capture it separately before normalization.
 */

export class InvalidAddressError extends Error {
  constructor(raw: string) {
    super(`Invalid Stellar address: ${raw}`);
    this.name = 'InvalidAddressError';
  }
}

/**
 * Validate and canonicalise a Stellar StrKey address.
 *
 * Accepts:
 *  - G... account StrKeys (canonical form)
 *  - M... muxed account StrKeys (mux ID stripped, returns underlying G...)
 *
 * Rejects anything else (contracts, secrets, malformed input) by throwing
 * InvalidAddressError. Whitespace is trimmed before validation.
 */
export function normalizeAddress(raw: string): string {
  if (typeof raw !== 'string') {
    throw new InvalidAddressError(String(raw));
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new InvalidAddressError(raw);
  }

  // Muxed account: strip the mux ID and return the underlying G... account.
  if (StrKey.isValidMed25519PublicKey(trimmed)) {
    const muxed = StrKey.decodeMed25519PublicKey(trimmed);
    // decodeMed25519PublicKey returns the 32-byte ed25519 key (mux ID stripped).
    return StrKey.encodeEd25519PublicKey(muxed);
  }

  if (StrKey.isValidEd25519PublicKey(trimmed)) {
    // Re-encode to guarantee canonical form.
    return StrKey.encodeEd25519PublicKey(StrKey.decodeEd25519PublicKey(trimmed));
  }

  throw new InvalidAddressError(raw);
}

/**
 * Non-throwing variant for use at boundaries where a boolean check is more
 * convenient (e.g. DTO validators).
 */
export function isValidAddress(raw: string): boolean {
  try {
    normalizeAddress(raw);
    return true;
  } catch {
    return false;
  }
}
