/**
 * Per-wallet rate limit: number of claims allowed per wallet per time window.
 */
export const WALLET_RATE_LIMIT_DEFAULTS = {
  LIMIT: 3,                    // claims per wallet per window
  WINDOW_SECONDS: 3600,        // 1 hour sliding window
};

/**
 * Dedicated appeal throttle (#1322). Stricter than claim filing because appeals
 * are rarer and higher-stakes; counters are isolated under `appeal:` Redis keys.
 */
export const APPEAL_RATE_LIMIT_DEFAULTS = {
  HOUR_LIMIT: 2,
  DAY_LIMIT: 5,
  HOUR_WINDOW_SECONDS: 3600,
  DAY_WINDOW_SECONDS: 86400,
};

/**
 * Global rate limit circuit breaker: total claims across all wallets per window.
 */
export const GLOBAL_RATE_LIMIT_DEFAULTS = {
  LIMIT: 100,                  // total claims per window across all wallets
  WINDOW_SECONDS: 300,         // 5 minute sliding window
};

export const RATE_LIMIT_DEFAULTS = {
  DEFAULT_LIMIT: 5,              // claims per window
  WINDOW_SIZE_LEDGERS: 17_280,   // ~24 hours at 5s/ledger
  ABSOLUTE_MAX_CAP: 100,         // hard limit, cannot be exceeded
  CACHE_TTL_SECONDS: 300,        // 5 minutes for config cache
};

export const REDIS_KEYS = {
  COUNTER: (policyId: string) => `rate_limit:counter:${policyId}`,
  CONFIG: (policyId: string) => `rate_limit:config:${policyId}`,
  DEFAULTS: 'rate_limit:defaults',
  WALLET_WINDOW: (wallet: string) => `rate_limit:wallet:${wallet}`,
  GLOBAL_WINDOW: 'rate_limit:global',
};
