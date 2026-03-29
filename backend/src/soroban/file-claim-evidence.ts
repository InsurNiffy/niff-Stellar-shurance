import { createHash } from 'crypto';
import { nativeToScVal, xdr } from '@stellar/stellar-sdk';

export type ClaimEvidenceInput = {
  url: string;
  /** 64 lowercase hex chars (32-byte SHA-256 digest). */
  contentSha256Hex: string;
};

const HEX = /^[0-9a-fA-F]{64}$/;

/**
 * Soroban `ClaimEvidenceEntry` map: { url: string, hash: bytes32 }.
 */
export function claimEvidenceEntryToScVal(entry: ClaimEvidenceInput): xdr.ScVal {
  const hex = entry.contentSha256Hex.trim();
  if (!HEX.test(hex)) {
    throw new Error('contentSha256Hex must be 64 hex characters');
  }
  const hash = Buffer.from(hex, 'hex');
  if (hash.length !== 32) {
    throw new Error('SHA-256 digest must be 32 bytes');
  }
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('url'),
      val: nativeToScVal(entry.url, { type: 'string' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('hash'),
      val: xdr.ScVal.scvBytes(hash),
    }),
  ]);
}

export function claimEvidenceVecToScVal(entries: ClaimEvidenceInput[]): xdr.ScVal {
  return xdr.ScVal.scvVec(entries.map(claimEvidenceEntryToScVal));
}

/** Compare SHA-256(bytes) to the 64-hex commitment (e.g. after IPFS fetch). */
export function contentMatchesSha256Commitment(
  content: Buffer,
  contentSha256Hex: string,
): boolean {
  const hex = contentSha256Hex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    return false;
  }
  const digest = createHash('sha256').update(content).digest('hex');
  return digest === hex;
}
