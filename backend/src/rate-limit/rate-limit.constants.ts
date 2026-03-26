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
};
