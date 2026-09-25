/**
 * Commit-reveal voting helpers (issue #1522).
 *
 * The salt is generated with crypto.getRandomValues and never leaves the
 * browser before reveal. It is never sent to the backend.
 *
 * Contract preimage format:
 *   keccak256(abi.encodePacked(claimId, voter, vote, salt))
 * where vote is encoded as a single byte (0 = against, 1 = for) and salt is
 * 32 bytes. The commitment is the keccak256 hash of that packed preimage.
 */

import { keccak256, encodePacked, toHex, type Hex } from 'viem';

export type VoteChoice = 'for' | 'against';

/** 32-byte salt generated with a CSPRNG. */
export type Salt = Hex;

export interface CommitmentInput {
  claimId: string | bigint;
  voter: string;
  vote: VoteChoice;
  salt: Salt;
}

/**
 * Generate a cryptographically secure 32-byte salt using
 * crypto.getRandomValues. The salt must be kept secret until reveal.
 */
export function generateSalt(): Salt {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** Encode a vote choice as the single byte used in the contract preimage. */
export function encodeVote(vote: VoteChoice): number {
  return vote === 'for' ? 1 : 0;
}

/**
 * Compute the commitment hash client-side, matching the contract's preimage
 * format: keccak256(abi.encodePacked(claimId, voter, vote, salt)).
 */
export function computeCommitment({
  claimId,
  voter,
  vote,
  salt,
}: CommitmentInput): Hex {
  return keccak256(
    encodePacked(
      ['uint256', 'address', 'uint8', 'bytes32'],
      [BigInt(claimId), voter as `0x${string}`, encodeVote(vote), salt],
    ),
  );
}

/**
 * Verify a revealed vote against a previously stored commitment. Used for
 * lost-salt recovery from a backup file.
 */
export function verifyCommitment(
  commitment: Hex,
  input: CommitmentInput,
): boolean {
  return computeCommitment(input).toLowerCase() === commitment.toLowerCase();
}

/**
 * Explain what happens if the vote is not revealed during the reveal window.
 * Surfaced in the UI so users understand the consequence before committing.
 */
export const NOT_REVEALED_EXPLANATION =
  'If you do not reveal your vote during the reveal window, your committed ' +
  'vote is discarded and cannot be counted. The commitment stays on-chain, ' +
  'but an unrevealed vote is treated as if you never voted — you cannot ' +
  'change it afterwards. Keep your salt and backup file safe so you can ' +
  'reveal in time.';
