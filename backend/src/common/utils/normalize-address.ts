/**
 * Address normalization — canonical format for all Stellar addresses stored in the DB.
 *
 * Canonical format: G-address (Ed25519 public key strkey, 56 chars).
 *
 * Rationale:
 *   - G-addresses are the universal, human-readable form supported by all Stellar tooling.
 *   - C-addresses (contract strkeys) are stored as-is; they are already canonical.
 *   - Muxed accounts (M-addresses): the mux ID is stripped and the base G-address is used.
 *     Product decision: mux IDs are routing hints, not identity — strip them for storage.
 *   - Invalid addresses are rejected at the API boundary with a clear error.
 */

import { StrKey, MuxedAccount } from '@stellar/stellar-sdk';
import { BadRequestException } from '@nestjs/common';

/**
 * Normalizes a raw Stellar address to its canonical storage form.
 *
 * - G-address  → returned as-is (validated)
 * - C-address  → returned as-is (validated)
 * - M-address  → mux ID stripped, base G-address returned
 * - Anything else → throws BadRequestException
 */
export function normalizeAddress(raw: string): string {
  if (!raw || typeof raw !== 'string') {
    throw new BadRequestException({
      code: 'INVALID_ADDRESS',
      message: 'Stellar address must be a non-empty string.',
    });
  }

  const trimmed = raw.trim();

  if (StrKey.isValidEd25519PublicKey(trimmed)) {
    return trimmed;
  }

  if (StrKey.isValidContract(trimmed)) {
    return trimmed;
  }

  // M-address: muxed account — strip mux ID, return base G-address
  if (trimmed.startsWith('M')) {
    try {
      const muxed = MuxedAccount.fromAddress(trimmed, '0');
      const base = muxed.baseAccount().accountId();
      if (StrKey.isValidEd25519PublicKey(base)) {
        return base;
      }
    } catch {
      // fall through to error below
    }
  }

  throw new BadRequestException({
    code: 'INVALID_ADDRESS',
    message: `"${trimmed}" is not a valid Stellar address (G-, C-, or M-address).`,
  });
}

/**
 * Normalizes without throwing — returns null on invalid input.
 * Use only in contexts where invalid addresses should be silently skipped (e.g. migrations).
 */
export function tryNormalizeAddress(raw: string): string | null {
  try {
    return normalizeAddress(raw);
  } catch {
    return null;
  }
}
