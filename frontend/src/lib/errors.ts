/**
 * Centralized error handling for NiffyInsur.
 *
 * - Maps backend/Stellar error codes → user-safe UI strings (i18n-ready keys).
 * - Carries optional correlation ID (requestId) for support escalation.
 * - Never surfaces private keys, seeds, or raw XDR in user-facing messages.
 */

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** All user-facing error strings. Keys are i18n-ready — swap values for translations. */
export const ERROR_MESSAGES: Record<string, string> = {
  // Generic
  UNKNOWN_ERROR: 'An unexpected error occurred. Please try again.',
  NETWORK_ERROR: 'Network connection failed. Please check your connection.',
  SERVER_ERROR: 'Server error. Please try again later.',
  TIMEOUT_ERROR: 'The request timed out. Please try again.',
  RATE_LIMIT_EXCEEDED: 'Too many requests. Please wait a moment and try again.',
  VALIDATION_ERROR: 'Please check your inputs and try again.',

  // Auth
  UNAUTHORIZED: 'Your session has expired. Please reconnect your wallet.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  WALLET_NOT_CONNECTED: 'Please connect your wallet to continue.',
  SIGNATURE_INVALID: 'Wallet signature was invalid. Please try again.',
  NONCE_EXPIRED: 'Authentication challenge expired. Please reconnect.',

  // Policy
  INVALID_QUOTE: 'The provided quote is invalid or has expired.',
  QUOTE_EXPIRED: 'This quote has expired. Please request a new one.',
  INVALID_WALLET_ADDRESS: 'The provided wallet address is not valid.',
  INSUFFICIENT_BALANCE: 'Insufficient balance to cover the premium and fees.',
  POLICY_ALREADY_EXISTS: 'A policy already exists for this quote.',
  TERMS_NOT_ACCEPTED: 'You must accept the terms and conditions.',

  // Claims
  CLAIM_NOT_FOUND: 'Claim not found.',
  CLAIM_ALREADY_EXISTS: 'A claim has already been filed for this policy.',
  POLICY_NOT_FOUND: 'Policy not found.',
  POLICY_INACTIVE: 'This policy is no longer active.',
  CLAIM_AMOUNT_EXCEEDS_COVERAGE: 'Claim amount exceeds your coverage limit.',
  OPEN_CLAIM_EXISTS: 'An open claim already exists for this policy.',

  // Voting
  ALREADY_VOTED: 'You have already voted on this claim.',
  NOT_A_VOTER: 'You are not eligible to vote on this claim.',
  VOTING_CLOSED: 'Voting for this claim has closed.',

  // Appeals — registered in backend/src/common/errors/error-catalog.ts
  NOT_CLAIMANT: 'Only the claimant can appeal this claim.',
  CLAIM_NOT_REJECTED: 'Only rejected claims can be appealed.',
  APPEAL_ALREADY_SUBMITTED: 'An appeal has already been submitted for this claim.',
  APPEAL_WINDOW_CLOSED: 'The appeal window for this claim has closed.',
  CLAIMS_PAUSED: 'Claim operations are currently paused by the contract admin.',

  // Stellar / Soroban
  TRANSACTION_FAILED: 'Transaction failed. Please try again.',
  TRANSACTION_REJECTED: 'Transaction was rejected by the network.',
  INSUFFICIENT_FEE: 'Transaction fee is too low. Please increase the fee.',
  CONTRACT_ERROR: 'Smart contract returned an error. Please try again.',
  SOROBAN_RPC_ERROR: 'Blockchain RPC error. Please try again shortly.',
  LEDGER_CLOSED: 'The ledger closed before your transaction was included. Please resubmit.',

  // Quote
  INVALID_CONTRACT_ADDRESS: 'The provided contract address is not valid.',
  INSUFFICIENT_COVERAGE: 'Coverage amount is below the minimum requirement.',
  EXCESSIVE_COVERAGE: 'Coverage amount exceeds the maximum limit.',
  HIGH_RISK_PROFILE: 'Your risk profile is too high for coverage at this time.',
  CONTRACT_NOT_SUPPORTED: 'This contract type is not currently supported.',
  INVALID_RISK_CATEGORY: 'Invalid risk category selected.',
  INVALID_DURATION: 'Policy duration is outside the allowed range.',
};

/**
 * Resolve a user-safe message from any thrown value.
 * Falls back gracefully — never exposes stack traces or raw error internals.
 */
export function resolveErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    return ERROR_MESSAGES[error.code] ?? ERROR_MESSAGES.UNKNOWN_ERROR;
  }
  if (error instanceof Error) {
    // Map well-known network errors
    if (error.message.toLowerCase().includes('failed to fetch')) {
      return ERROR_MESSAGES.NETWORK_ERROR;
    }
  }
  return ERROR_MESSAGES.UNKNOWN_ERROR;
}

/** Extract correlation ID from an error for support escalation. */
export function getCorrelationId(error: unknown): string | undefined {
  if (error instanceof AppError) return error.requestId;
  return undefined;
}

// ── Error catalog (human-readable descriptions for /support/error-codes) ─────

export interface ErrorCatalogEntry {
  code: string;
  message: string;
  causes: string[];
  resolution: string;
}

export const ERROR_CATALOG: ErrorCatalogEntry[] = [
  {
    code: 'UNKNOWN_ERROR',
    message: ERROR_MESSAGES.UNKNOWN_ERROR,
    causes: ['An unhandled exception occurred server-side or in the browser.'],
    resolution: 'Refresh the page and try again. If the issue persists, contact support with the correlation ID.',
  },
  {
    code: 'NETWORK_ERROR',
    message: ERROR_MESSAGES.NETWORK_ERROR,
    causes: ['Your device is offline.', 'The server is temporarily unreachable.'],
    resolution: 'Check your internet connection, then retry. If on a VPN, try disabling it.',
  },
  {
    code: 'SERVER_ERROR',
    message: ERROR_MESSAGES.SERVER_ERROR,
    causes: ['An internal server error occurred (5xx).', 'Ongoing maintenance or deployment.'],
    resolution: 'Wait a few minutes and try again. Check the status page for outage information.',
  },
  {
    code: 'TIMEOUT_ERROR',
    message: ERROR_MESSAGES.TIMEOUT_ERROR,
    causes: ['Slow network connection.', 'Server under heavy load.'],
    resolution: 'Retry the action. On a slow connection, allow extra time for large transactions.',
  },
  {
    code: 'RATE_LIMIT_EXCEEDED',
    message: ERROR_MESSAGES.RATE_LIMIT_EXCEEDED,
    causes: ['Too many API requests in a short period.'],
    resolution: 'Wait 60 seconds before retrying. Avoid rapidly submitting the same form.',
  },
  {
    code: 'VALIDATION_ERROR',
    message: ERROR_MESSAGES.VALIDATION_ERROR,
    causes: ['A required field is missing or contains an invalid value.'],
    resolution: 'Review all highlighted fields and correct the values before resubmitting.',
  },
  {
    code: 'UNAUTHORIZED',
    message: ERROR_MESSAGES.UNAUTHORIZED,
    causes: ['Your session token has expired.', 'Wallet disconnected during the session.'],
    resolution: 'Reconnect your wallet and sign a new authentication challenge.',
  },
  {
    code: 'FORBIDDEN',
    message: ERROR_MESSAGES.FORBIDDEN,
    causes: ['Your wallet address does not have the required role.', 'Accessing an admin-only endpoint.'],
    resolution: 'Ensure you are using the correct wallet. Contact an admin if access should be granted.',
  },
  {
    code: 'WALLET_NOT_CONNECTED',
    message: ERROR_MESSAGES.WALLET_NOT_CONNECTED,
    causes: ['No wallet extension is connected.', 'Wallet was disconnected or locked.'],
    resolution: 'Click "Connect Wallet" and approve the connection in your wallet extension.',
  },
  {
    code: 'SIGNATURE_INVALID',
    message: ERROR_MESSAGES.SIGNATURE_INVALID,
    causes: ['The signed payload did not match the expected nonce.', 'Wallet returned a malformed signature.'],
    resolution: 'Disconnect and reconnect your wallet, then retry the action.',
  },
  {
    code: 'NONCE_EXPIRED',
    message: ERROR_MESSAGES.NONCE_EXPIRED,
    causes: ['The authentication nonce was not signed within the allowed window (≈5 minutes).'],
    resolution: 'Start the connection flow again promptly and sign the challenge within 5 minutes.',
  },
  {
    code: 'INVALID_QUOTE',
    message: ERROR_MESSAGES.INVALID_QUOTE,
    causes: ['The quote ID does not exist.', 'The quote parameters were tampered with.'],
    resolution: 'Request a fresh quote from the quote page and proceed immediately.',
  },
  {
    code: 'QUOTE_EXPIRED',
    message: ERROR_MESSAGES.QUOTE_EXPIRED,
    causes: ['Quotes are valid for 15 minutes. The expiry time has passed.'],
    resolution: 'Return to the quote page and submit a new quote request.',
  },
  {
    code: 'INVALID_WALLET_ADDRESS',
    message: ERROR_MESSAGES.INVALID_WALLET_ADDRESS,
    causes: ['The wallet address is not a valid 56-character Stellar public key (G…).'],
    resolution: 'Copy your wallet address from your Stellar wallet and paste it again.',
  },
  {
    code: 'INSUFFICIENT_BALANCE',
    message: ERROR_MESSAGES.INSUFFICIENT_BALANCE,
    causes: ['Your XLM balance is too low to pay the premium plus network fees.'],
    resolution: 'Top up your wallet with XLM and retry. Consider using the on-ramp feature.',
  },
  {
    code: 'POLICY_ALREADY_EXISTS',
    message: ERROR_MESSAGES.POLICY_ALREADY_EXISTS,
    causes: ['A policy was already purchased for this quote ID.'],
    resolution: 'View your existing policy on the Policies page. Request a new quote if you need additional coverage.',
  },
  {
    code: 'TERMS_NOT_ACCEPTED',
    message: ERROR_MESSAGES.TERMS_NOT_ACCEPTED,
    causes: ['The terms and conditions checkbox was not checked before submitting.'],
    resolution: 'Read and accept the terms and conditions, then submit again.',
  },
  {
    code: 'CLAIM_NOT_FOUND',
    message: ERROR_MESSAGES.CLAIM_NOT_FOUND,
    causes: ['The claim ID does not exist in the indexer or on-chain.', 'The ID in the URL is incorrect.'],
    resolution: 'Check the URL and claim ID. Navigate from the Claims page to find the correct claim.',
  },
  {
    code: 'CLAIM_ALREADY_EXISTS',
    message: ERROR_MESSAGES.CLAIM_ALREADY_EXISTS,
    causes: ['A claim was already filed under this policy.'],
    resolution: 'Find your existing claim on the Claims page. Only one active claim per policy is allowed.',
  },
  {
    code: 'POLICY_NOT_FOUND',
    message: ERROR_MESSAGES.POLICY_NOT_FOUND,
    causes: ['The referenced policy does not exist or belongs to a different wallet.'],
    resolution: 'Ensure you are connected with the wallet that owns the policy.',
  },
  {
    code: 'POLICY_INACTIVE',
    message: ERROR_MESSAGES.POLICY_INACTIVE,
    causes: ['The policy has expired or been terminated.'],
    resolution: 'You can only file claims against active policies. Renew or purchase a new policy.',
  },
  {
    code: 'CLAIM_AMOUNT_EXCEEDS_COVERAGE',
    message: ERROR_MESSAGES.CLAIM_AMOUNT_EXCEEDS_COVERAGE,
    causes: ['The requested claim amount is greater than the policy coverage limit.'],
    resolution: 'Reduce the claim amount to be within your coverage limit.',
  },
  {
    code: 'OPEN_CLAIM_EXISTS',
    message: ERROR_MESSAGES.OPEN_CLAIM_EXISTS,
    causes: ['There is already an open (Processing or Pending) claim for this policy.'],
    resolution: 'Wait for the existing claim to be resolved before filing a new one.',
  },
  {
    code: 'ALREADY_VOTED',
    message: ERROR_MESSAGES.ALREADY_VOTED,
    causes: ['Your wallet has already cast a vote on this claim.'],
    resolution: 'Each eligible voter may only vote once per claim. No action needed.',
  },
  {
    code: 'NOT_A_VOTER',
    message: ERROR_MESSAGES.NOT_A_VOTER,
    causes: ['Your wallet is not registered as an eligible voter.', 'Voting eligibility is determined at claim filing time.'],
    resolution: 'Only registered voters may vote on claims. Contact governance if you believe this is an error.',
  },
  {
    code: 'VOTING_CLOSED',
    message: ERROR_MESSAGES.VOTING_CLOSED,
    causes: ['The voting deadline ledger has passed.'],
    resolution: 'The voting window for this claim has closed. No further votes can be cast.',
  },
  {
    code: 'TRANSACTION_FAILED',
    message: ERROR_MESSAGES.TRANSACTION_FAILED,
    causes: ['The Stellar transaction was rejected by validators.', 'An on-chain precondition was not met.'],
    resolution: 'Retry the transaction. If it fails again, check for conflicting on-chain state.',
  },
  {
    code: 'TRANSACTION_REJECTED',
    message: ERROR_MESSAGES.TRANSACTION_REJECTED,
    causes: ['You rejected the transaction in your wallet.', 'The wallet extension timed out.'],
    resolution: 'Re-initiate the action and approve the transaction in your wallet when prompted.',
  },
  {
    code: 'INSUFFICIENT_FEE',
    message: ERROR_MESSAGES.INSUFFICIENT_FEE,
    causes: ['The submitted transaction fee (base + resource fee) was below the network minimum.'],
    resolution: 'The app automatically calculates fees. Retry; if the error persists, your XLM balance may be too low.',
  },
  {
    code: 'CONTRACT_ERROR',
    message: ERROR_MESSAGES.CONTRACT_ERROR,
    causes: ['The Soroban smart contract returned a non-zero error code.', 'Business logic precondition failed on-chain.'],
    resolution: 'Note any displayed error code and contact support. Do not retry without investigating.',
  },
  {
    code: 'SOROBAN_RPC_ERROR',
    message: ERROR_MESSAGES.SOROBAN_RPC_ERROR,
    causes: ['The Soroban RPC node returned an error or is temporarily unavailable.'],
    resolution: 'Wait a minute and retry. The app will automatically switch to a fallback RPC if available.',
  },
  {
    code: 'LEDGER_CLOSED',
    message: ERROR_MESSAGES.LEDGER_CLOSED,
    causes: ['The ledger closed before your transaction was included in a block.'],
    resolution: 'Resubmit the transaction. This can happen during high network congestion.',
  },
  {
    code: 'INVALID_CONTRACT_ADDRESS',
    message: ERROR_MESSAGES.INVALID_CONTRACT_ADDRESS,
    causes: ['The Soroban contract address in the app configuration is malformed.'],
    resolution: 'This is a configuration issue. Contact the team; do not manually edit contract addresses.',
  },
  {
    code: 'INSUFFICIENT_COVERAGE',
    message: ERROR_MESSAGES.INSUFFICIENT_COVERAGE,
    causes: ['The requested coverage amount is below the protocol minimum.'],
    resolution: 'Increase the coverage amount to meet the minimum requirement shown on the quote page.',
  },
  {
    code: 'EXCESSIVE_COVERAGE',
    message: ERROR_MESSAGES.EXCESSIVE_COVERAGE,
    causes: ['The requested coverage amount exceeds the protocol maximum.'],
    resolution: 'Reduce the coverage amount or split coverage across multiple policies.',
  },
  {
    code: 'HIGH_RISK_PROFILE',
    message: ERROR_MESSAGES.HIGH_RISK_PROFILE,
    causes: ['Your on-chain risk profile score exceeds the threshold for new coverage.'],
    resolution: 'Wait for existing claims to resolve. You may reapply after your risk score decreases.',
  },
  {
    code: 'CONTRACT_NOT_SUPPORTED',
    message: ERROR_MESSAGES.CONTRACT_NOT_SUPPORTED,
    causes: ['The selected contract type is disabled or not yet deployed to this network.'],
    resolution: 'Choose a supported contract type. Check the documentation for available options.',
  },
  {
    code: 'INVALID_RISK_CATEGORY',
    message: ERROR_MESSAGES.INVALID_RISK_CATEGORY,
    causes: ['An unrecognised risk category string was submitted.'],
    resolution: 'Select a valid risk category from the dropdown. Do not manually edit the URL parameters.',
  },
  {
    code: 'INVALID_DURATION',
    message: ERROR_MESSAGES.INVALID_DURATION,
    causes: ['The policy duration is outside the allowed range (typically 30–365 days).'],
    resolution: 'Adjust the duration to fall within the allowed range shown on the quote form.',
  },
];
