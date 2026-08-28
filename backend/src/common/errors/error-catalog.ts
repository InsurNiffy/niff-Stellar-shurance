/**
 * Error Catalog — single source of truth for all API error codes.
 *
 * Rules:
 *  - Codes are STABLE across releases. Never rename; deprecate instead.
 *  - HTTP status must be semantically correct per RFC 7231.
 *  - i18nKey maps to frontend i18n message files (exported via scripts/export-error-catalog.ts).
 *  - To add a new code: add an entry here, open a PR with the required review steps
 *    documented in docs/error-catalog.md, then reference it in the throwing site.
 *  - To deprecate: set `deprecated: true` and add a `replacedBy` pointer.
 *    Do NOT remove the entry — old clients may still receive the code.
 */

import { HttpStatus } from '@nestjs/common';

// Re-export so callers don't need a separate import.
export { HttpStatus };


export interface CatalogEntry {
  /** Stable string code emitted in API responses. */
  code: string;
  /** RFC 7231-compliant HTTP status. */
  httpStatus: number;
  /** Frontend i18n message key. */
  i18nKey: string;
  /** Human-readable description for developers (not sent to clients). */
  description: string;
  /** Set true when the code is superseded; keep the entry for backward compat. */
  deprecated?: boolean;
  /** Code that replaces this one when deprecated. */
  replacedBy?: string;
}

export const ERROR_CATALOG = {
  // ── Auth ──────────────────────────────────────────────────────────────────
  SIGNATURE_INVALID: {
    code: 'SIGNATURE_INVALID',
    httpStatus: HttpStatus.UNAUTHORIZED,
    i18nKey: 'errors.auth.signatureInvalid',
    description: 'Wallet signature verification failed.',
  },
  NONCE_EXPIRED: {
    code: 'NONCE_EXPIRED',
    httpStatus: HttpStatus.UNAUTHORIZED,
    i18nKey: 'errors.auth.nonceExpired',
    description: 'The sign-in nonce has expired; request a new one.',
  },
  TOKEN_EXPIRED: {
    code: 'TOKEN_EXPIRED',
    httpStatus: HttpStatus.UNAUTHORIZED,
    i18nKey: 'errors.auth.tokenExpired',
    description: 'JWT access token has expired.',
  },
  UNAUTHORIZED: {
    code: 'UNAUTHORIZED',
    httpStatus: HttpStatus.UNAUTHORIZED,
    i18nKey: 'errors.auth.unauthorized',
    description: 'Request is not authenticated.',
  },
  FORBIDDEN: {
    code: 'FORBIDDEN',
    httpStatus: HttpStatus.FORBIDDEN,
    i18nKey: 'errors.auth.forbidden',
    description: 'Authenticated user lacks permission for this action.',
  },

  // ── Wallet / Account ──────────────────────────────────────────────────────
  INVALID_WALLET_ADDRESS: {
    code: 'INVALID_WALLET_ADDRESS',
    httpStatus: HttpStatus.BAD_REQUEST,
    i18nKey: 'errors.wallet.invalidAddress',
    description: 'The supplied Stellar address is not valid or does not exist on-chain.',
  },
  ACCOUNT_NOT_FOUND: {
    code: 'ACCOUNT_NOT_FOUND',
    httpStatus: HttpStatus.BAD_REQUEST,
    i18nKey: 'errors.wallet.accountNotFound',
    description: 'Stellar account not found; fund it with at least 1 XLM.',
  },
  WRONG_NETWORK: {
    code: 'WRONG_NETWORK',
    httpStatus: HttpStatus.BAD_REQUEST,
    i18nKey: 'errors.wallet.wrongNetwork',
    description: 'RPC network passphrase mismatch.',
  },
  INSUFFICIENT_BALANCE: {
    code: 'INSUFFICIENT_BALANCE',
    httpStatus: HttpStatus.BAD_REQUEST,
    i18nKey: 'errors.wallet.insufficientBalance',
    description: 'Account does not have enough XLM to cover fees.',
  },

  // ── Transaction / Contract ────────────────────────────────────────────────
  TRANSACTION_FAILED: {
    code: 'TRANSACTION_FAILED',
    httpStatus: HttpStatus.BAD_REQUEST,
    i18nKey: 'errors.tx.failed',
    description: 'Stellar transaction was rejected by the network.',
  },
  TRANSACTION_REJECTED: {
    code: 'TRANSACTION_REJECTED',
    httpStatus: HttpStatus.BAD_REQUEST,
    i18nKey: 'errors.tx.rejected',
    description: 'Transaction was rejected at submission time.',
  },
  INSUFFICIENT_FEE: {
    code: 'INSUFFICIENT_FEE',
    httpStatus: HttpStatus.BAD_REQUEST,
    i18nKey: 'errors.tx.insufficientFee',
    description: 'Transaction fee is below the network minimum.',
  },
  SIMULATION_TIMEOUT: {
    code: 'SIMULATION_TIMEOUT',
    httpStatus: HttpStatus.GATEWAY_TIMEOUT,
    i18nKey: 'errors.tx.simulationTimeout',
    description: 'Soroban simulate_transaction timed out.',
  },
  SIMULATION_FAILED: {
    code: 'SIMULATION_FAILED',
    httpStatus: HttpStatus.BAD_REQUEST,
    i18nKey: 'errors.tx.simulationFailed',
    description: 'Soroban simulation returned an error.',
  },
  SIMULATION_DECODE_FAILED: {
    code: 'SIMULATION_DECODE_FAILED',
    httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
    i18nKey: 'errors.tx.simulationDecodeFailed',
    description: 'Could not decode the simulation return value.',
  },
  CONTRACT_NOT_DEPLOYED: {
    code: 'CONTRACT_NOT_DEPLOYED',
    httpStatus: HttpStatus.SERVICE_UNAVAILABLE,
    i18nKey: 'errors.tx.contractNotDeployed',
    description: 'Smart contract is not deployed on this network.',
  },
  CONTRACT_NOT_CONFIGURED: {
    code: 'CONTRACT_NOT_CONFIGURED',
    httpStatus: HttpStatus.BAD_REQUEST,
    i18nKey: 'errors.tx.contractNotConfigured',
    description: 'CONTRACT_ID environment variable is not set.',
  },
  CONTRACT_NOT_INITIALIZED: {
    code: 'CONTRACT_NOT_INITIALIZED',
    httpStatus: HttpStatus.BAD_REQUEST,
    i18nKey: 'errors.tx.contractNotInitialized',
    description: 'Contract is not initialized for this operation.',
  },
  SUBMISSION_FAILED: {
    code: 'SUBMISSION_FAILED',
    httpStatus: HttpStatus.SERVICE_UNAVAILABLE,
    i18nKey: 'errors.tx.submissionFailed',
    description: 'Failed to submit transaction to the Soroban RPC.',
  },
  LEDGER_CLOSED: {
    code: 'LEDGER_CLOSED',
    httpStatus: HttpStatus.BAD_REQUEST,
    i18nKey: 'errors.tx.ledgerClosed',
    description: 'Target ledger has already closed.',
  },
  TIMEOUT_ERROR: {
    code: 'TIMEOUT_ERROR',
    httpStatus: HttpStatus.GATEWAY_TIMEOUT,
    i18nKey: 'errors.tx.timeout',
    description: 'RPC call timed out.',
  },
  RPC_UNAVAILABLE: {
    code: 'RPC_UNAVAILABLE',
    httpStatus: HttpStatus.SERVICE_UNAVAILABLE,
    i18nKey: 'errors.rpc.unavailable',
    description: 'Soroban RPC endpoint is unreachable.',
  },

  // ── Policy ────────────────────────────────────────────────────────────────
  POLICY_NOT_FOUND: {
    code: 'POLICY_NOT_FOUND',
    httpStatus: HttpStatus.NOT_FOUND,
    i18nKey: 'errors.policy.notFound',
    description: 'Policy does not exist.',
  },
  POLICY_BATCH_TOO_LARGE: {
    code: 'POLICY_BATCH_TOO_LARGE',
    httpStatus: HttpStatus.BAD_REQUEST,
    i18nKey: 'errors.policy.batchTooLarge',
    description: 'Batch request exceeds the maximum allowed policy count.',
  },

  // ── Claims ────────────────────────────────────────────────────────────────
  CLAIM_NOT_FOUND: {
    code: 'CLAIM_NOT_FOUND',
    httpStatus: HttpStatus.NOT_FOUND,
    i18nKey: 'errors.claim.notFound',
    description: 'Claim does not exist.',
  },
  CLAIM_ALREADY_FINALIZED: {
    code: 'CLAIM_ALREADY_FINALIZED',
    httpStatus: HttpStatus.CONFLICT,
    i18nKey: 'errors.claim.alreadyFinalized',
    description: 'Claim has already been finalized and cannot be modified.',
  },
  CLAIMS_PAUSED: {
    code: 'CLAIMS_PAUSED',
    httpStatus: HttpStatus.SERVICE_UNAVAILABLE,
    i18nKey: 'errors.claim.claimsPaused',
    description: 'Claim operations (including appeals) are paused by the contract admin.',
  },

  // ── Appeals ───────────────────────────────────────────────────────────────
  // Emitted by the appeal endpoints (POST /claims/:id/appeal/build-transaction
  // and POST /claims/:id/appeal). Each maps 1-to-1 onto a contract-side
  // `validate::Error` variant surfaced through Soroban simulation.
  NOT_CLAIMANT: {
    code: 'NOT_CLAIMANT',
    httpStatus: HttpStatus.FORBIDDEN,
    i18nKey: 'errors.appeal.notClaimant',
    description:
      'Only the original claimant may appeal a claim; the calling wallet is a different address.',
  },
  CLAIM_NOT_REJECTED: {
    code: 'CLAIM_NOT_REJECTED',
    httpStatus: HttpStatus.CONFLICT,
    i18nKey: 'errors.appeal.claimNotRejected',
    description:
      'Appeals are only permitted on rejected claims; this claim is in a different status.',
  },
  APPEAL_ALREADY_SUBMITTED: {
    code: 'APPEAL_ALREADY_SUBMITTED',
    httpStatus: HttpStatus.CONFLICT,
    i18nKey: 'errors.appeal.alreadySubmitted',
    description:
      'An appeal has already been recorded for this claim (contract allows one appeal per claim).',
  },
  APPEAL_WINDOW_CLOSED: {
    code: 'APPEAL_WINDOW_CLOSED',
    httpStatus: HttpStatus.CONFLICT,
    i18nKey: 'errors.appeal.windowClosed',
    description:
      'The appeal window closed; the current ledger is past the claim appeal_open_deadline_ledger.',
  },

  // ── Rate limiting ─────────────────────────────────────────────────────────
  RATE_LIMIT_EXCEEDED: {
    code: 'RATE_LIMIT_EXCEEDED',
    httpStatus: HttpStatus.TOO_MANY_REQUESTS,
    i18nKey: 'errors.rateLimit.exceeded',
    description: 'Too many requests; retry after the window resets.',
  },

  // ── Validation ────────────────────────────────────────────────────────────
  VALIDATION_ERROR: {
    code: 'VALIDATION_ERROR',
    httpStatus: HttpStatus.UNPROCESSABLE_ENTITY,
    i18nKey: 'errors.validation.failed',
    description: 'Request body failed schema validation.',
  },

  // ── Generic ───────────────────────────────────────────────────────────────
  NOT_FOUND: {
    code: 'NOT_FOUND',
    httpStatus: HttpStatus.NOT_FOUND,
    i18nKey: 'errors.generic.notFound',
    description: 'Requested resource was not found.',
  },
  INTERNAL_ERROR: {
    code: 'INTERNAL_ERROR',
    httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
    i18nKey: 'errors.generic.internalError',
    description: 'Unexpected server error.',
  },
} as const satisfies Record<string, CatalogEntry>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

/** Look up a catalog entry by code string (for runtime use in the exception filter). */
export function getCatalogEntry(code: string): CatalogEntry | undefined {
  return (ERROR_CATALOG as Record<string, CatalogEntry>)[code];
}
