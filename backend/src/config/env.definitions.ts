import * as Joi from 'joi';

export type DeploymentEnvironment = 'development' | 'production' | 'test';
export type StellarNetwork = 'testnet' | 'mainnet' | 'futurenet';
export type IpfsProvider = 'mock' | 'pinata';
export type CaptchaProvider = 'turnstile' | 'hcaptcha';
export type LogLevel = 'error' | 'warn' | 'log' | 'verbose' | 'debug';

export interface EnvironmentVariables {
  NODE_ENV: DeploymentEnvironment;
  PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  STELLAR_NETWORK: StellarNetwork;
  SOROBAN_RPC_URL: string;
  HORIZON_URL: string;
  STELLAR_NETWORK_PASSPHRASE: string;
  CONTRACT_ID: string;
  DEFAULT_TOKEN_CONTRACT_ID: string;
  SOROBAN_RPC_URL_TESTNET: string;
  SOROBAN_RPC_URL_MAINNET: string;
  SOROBAN_RPC_URL_FUTURENET: string;
  HORIZON_URL_TESTNET: string;
  HORIZON_URL_MAINNET: string;
  HORIZON_URL_FUTURENET: string;
  CONTRACT_ID_TESTNET: string;
  CONTRACT_ID_MAINNET: string;
  CONTRACT_ID_FUTURENET: string;
  DEFAULT_TOKEN_CONTRACT_ID_TESTNET: string;
  DEFAULT_TOKEN_CONTRACT_ID_MAINNET: string;
  DEFAULT_TOKEN_CONTRACT_ID_FUTURENET: string;
  INDEXER_GAP_ALERT_THRESHOLD_LEDGERS: number;
  INDEXER_GAP_ALERT_COOLDOWN_MS: number;
  IPFS_PROVIDER: IpfsProvider;
  PINATA_API_KEY: string;
  PINATA_API_SECRET: string;
  PINATA_GATEWAY_URL: string;
  IPFS_MAX_FILE_SIZE: number;
  IPFS_MIN_FILE_SIZE: number;
  IPFS_STRIP_EXIF: boolean;
  IPFS_GATEWAY: string;
  ALLOWED_IPFS_GATEWAYS: string;
  IPFS_PROJECT_ID: string;
  IPFS_PROJECT_SECRET: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  JWT_REFRESH_EXPIRES_IN: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  ADMIN_TOKEN: string;
  AUTH_DOMAIN: string;
  NONCE_TTL_SECONDS: number;
  FRONTEND_ORIGINS: string;
  ADMIN_CORS_ORIGINS: string;
  LOG_LEVEL: LogLevel;
  CACHE_TTL_SECONDS: number;
  QUOTE_SIMULATION_CACHE_ENABLED: 'true' | 'false' | '1' | '0';
  QUOTE_SIMULATION_CACHE_TTL_SECONDS: number;
  CAPTCHA_PROVIDER: CaptchaProvider;
  CAPTCHA_SECRET_KEY: string;
  CAPTCHA_SITE_KEY: string;
  IP_HASH_SALT: string;
  TENANT_RESOLUTION_ENABLED: boolean;
  TENANT_BASE_DOMAIN: string;
  DATA_RETENTION_DAYS: number;
  DB_POOL_MAX: number;
  DB_POOL_MIN: number;
  DB_POOL_IDLE_TIMEOUT_MS: number;
  DB_POOL_CONNECTION_TIMEOUT_MS: number;
  DB_SLOW_QUERY_MS: number;
  GRAPHQL_ENABLED: boolean;
  GRAPHQL_PATH: string;
  GRAPHQL_INTROSPECTION_IN_PRODUCTION: boolean;
  GRAPHQL_MAX_DEPTH: number;
  GRAPHQL_MAX_COMPLEXITY: number;
  GRAPHQL_RATE_LIMIT_MAX: number;
  GRAPHQL_RATE_LIMIT_WINDOW_MS: number;
  GRAPHQL_SLOW_OPERATION_MS: number;
  GRAPHQL_PERSISTED_QUERIES_ENABLED: boolean;
  GRAPHQL_PERSISTED_QUERY_TTL_SECONDS: number;
  GRAPHQL_POLICY_CLAIMS_DEFAULT_LIMIT: number;
  GRAPHQL_POLICY_CLAIMS_MAX_LIMIT: number;
  HORIZON_API_KEY: string;
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_USER: string;
  SMTP_PASS: string;
  SMTP_FROM: string;
  TELEGRAM_BOT_TOKEN: string;
  DISCORD_WEBHOOK_URL: string;
  FEATURE_FLAGS_JSON: string;
  FEATURE_FLAGS_DISABLED_STATUS: '403' | '404';
  RAMP_URL: string;
  RAMP_ALLOWED_REGIONS: string;
  RAMP_UTM_SOURCE: string;
  RAMP_UTM_MEDIUM: string;
  RAMP_UTM_CAMPAIGN: string;
  SSE_MAX_CONNECTIONS: number;
  SOLVENCY_MONITORING_ENABLED: string;
  SOLVENCY_CRON_EXPRESSION: string;
  SOLVENCY_BUFFER_THRESHOLD_STROOPS: string;
  SOLVENCY_SIMULATION_SOURCE_ACCOUNT: string;
  SOLVENCY_TENANT_ID: string;
  SOLVENCY_ALERT_WEBHOOK_URL: string;
  SOLVENCY_ALERT_WEBHOOK_SECRET: string;
  WASM_DRIFT_WEBHOOK_URL: string;
  WASM_DRIFT_WEBHOOK_SECRET: string;
  DEPLOYMENT_REGISTRY_PATH: string;
  NIFFYINSURE_EXPECTED_WASM_HASH: string;
  WEBHOOK_SECRET_GITHUB: string;
  WEBHOOK_SECRET_STRIPE: string;
  WEBHOOK_SECRET_GENERIC: string;
  WEBHOOK_IP_ALLOWLIST_GITHUB: string;
  WEBHOOK_IP_ALLOWLIST_STRIPE: string;
  WEBHOOK_IP_ALLOWLIST_GENERIC: string;
  PAGINATION_HMAC_SECRET: string;
  DISABLE_REINDEX_WORKER: string;
  RENEWAL_REMINDER_CRON: string;
  /**
   * Optional incoming JWT signing key used during zero-downtime rotation.
   * When set, tokens signed with JWT_SECRET_NEXT are also accepted.
   * Remove after the overlap window (≥ JWT_EXPIRES_IN) has elapsed.
   */
  JWT_SECRET_NEXT: string;
}

export type EnvKey = keyof EnvironmentVariables;
export type TypedConfigService = import('@nestjs/config').ConfigService<
  EnvironmentVariables,
  true
>;

type Requirement = 'required' | 'optional' | 'conditional';

export interface EnvDefinition<K extends EnvKey = EnvKey> {
  key: K;
  section: string;
  description: string;
  example: string;
  required: Requirement;
  secret?: boolean;
  schema: Joi.Schema;
}

type EnvDefinitionMap = { [K in EnvKey]: EnvDefinition<K> };

const durationSchema = Joi.string().pattern(/^\d+[smhd]$/);
const featureFlagsSchema = Joi.string()
  .allow('')
  .custom((value: string, helpers) => {
    if (!value.trim()) {
      return '';
    }

    try {
      const parsed = JSON.parse(value) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return helpers.error('any.invalid');
      }
      return value;
    } catch {
      return helpers.error('any.invalid');
    }
  }, 'feature flag JSON validation')
  .messages({
    'any.invalid': 'FEATURE_FLAGS_JSON must be a JSON object when provided',
  });

function rejectProductionPlaceholder(
  value: string,
  helpers: Joi.CustomHelpers,
  disallowed: readonly string[],
  message: string,
): string {
  const nodeEnv =
    (helpers.state.ancestors[0] as Partial<EnvironmentVariables> | undefined)?.NODE_ENV ??
    'development';

  if (nodeEnv === 'production' && disallowed.includes(value.trim())) {
    return helpers.error('any.invalid', { message }) as unknown as string;
  }

  return value;
}

const frontendOriginsSchema = Joi.string()
  .required()
  .custom((value: string, helpers) => {
    const nodeEnv =
      (helpers.state.ancestors[0] as Partial<EnvironmentVariables> | undefined)?.NODE_ENV ??
      'development';

    if (nodeEnv !== 'production') {
      return value;
    }

    const entries = value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    for (const entry of entries) {
      if (entry === '*') {
        return helpers.error('any.invalid', {
          message: 'FRONTEND_ORIGINS must not contain "*" in production',
        });
      }

      if (!entry.startsWith('https://')) {
        return helpers.error('any.invalid', {
          message: `FRONTEND_ORIGINS entry "${entry}" must start with https:// in production`,
        });
      }
    }

    return value;
  });

export const ENV_DEFINITIONS: EnvDefinitionMap = {
  NODE_ENV: {
    key: 'NODE_ENV',
    section: 'Core',
    description: 'Runtime environment name used for validation and defaults.',
    example: 'development',
    required: 'required',
    schema: Joi.string().valid('development', 'production', 'test').default('development'),
  },
  PORT: {
    key: 'PORT',
    section: 'Core',
    description: 'HTTP port bound by the Nest API process.',
    example: '3000',
    required: 'required',
    schema: Joi.number().integer().min(0).default(3000),
  },
  DATABASE_URL: {
    key: 'DATABASE_URL',
    section: 'Core',
    description:
      'Primary PostgreSQL connection string. Use a least-privilege application user for writes.',
    example: 'postgresql://niffy_app:replace-me@localhost:5432/niffyinsure?schema=public',
    required: 'required',
    secret: true,
    schema: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }).required(),
  },
  REDIS_URL: {
    key: 'REDIS_URL',
    section: 'Core',
    description: 'Redis connection string for cache, queues, and nonce storage.',
    example: 'redis://localhost:6379/0',
    required: 'required',
    secret: true,
    schema: Joi.string().uri({ scheme: ['redis', 'rediss'] }).required(),
  },
  STELLAR_NETWORK: {
    key: 'STELLAR_NETWORK',
    section: 'Stellar',
    description: 'Active Stellar network for RPC, Horizon, and contract resolution.',
    example: 'testnet',
    required: 'required',
    schema: Joi.string().valid('testnet', 'mainnet', 'futurenet').default('testnet'),
  },
  SOROBAN_RPC_URL: {
    key: 'SOROBAN_RPC_URL',
    section: 'Stellar',
    description: 'Soroban RPC endpoint for the active network.',
    example: 'https://soroban-testnet.stellar.org',
    required: 'required',
    schema: Joi.string().uri().required(),
  },
  HORIZON_URL: {
    key: 'HORIZON_URL',
    section: 'Stellar',
    description: 'Horizon endpoint for the active network.',
    example: 'https://horizon-testnet.stellar.org',
    required: 'required',
    schema: Joi.string().uri().required(),
  },
  STELLAR_NETWORK_PASSPHRASE: {
    key: 'STELLAR_NETWORK_PASSPHRASE',
    section: 'Stellar',
    description: 'Canonical network passphrase matching STELLAR_NETWORK.',
    example: 'Test SDF Network ; September 2015',
    required: 'required',
    schema: Joi.string().required(),
  },
  CONTRACT_ID: {
    key: 'CONTRACT_ID',
    section: 'Stellar',
    description: 'Default deployed niffyinsure contract ID for the active network.',
    example: '',
    required: 'optional',
    schema: Joi.string().allow('').default(''),
  },
  DEFAULT_TOKEN_CONTRACT_ID: {
    key: 'DEFAULT_TOKEN_CONTRACT_ID',
    section: 'Stellar',
    description: 'Default SEP-41 token contract ID used when no asset override is supplied.',
    example: '',
    required: 'optional',
    schema: Joi.string().allow('').default(''),
  },
  SOROBAN_RPC_URL_TESTNET: {
    key: 'SOROBAN_RPC_URL_TESTNET',
    section: 'Stellar',
    description: 'Optional per-network RPC override for testnet.',
    example: '',
    required: 'optional',
    schema: Joi.string().uri().allow('').default(''),
  },
  SOROBAN_RPC_URL_MAINNET: {
    key: 'SOROBAN_RPC_URL_MAINNET',
    section: 'Stellar',
    description: 'Optional per-network RPC override for mainnet.',
    example: '',
    required: 'optional',
    schema: Joi.string().uri().allow('').default(''),
  },
  SOROBAN_RPC_URL_FUTURENET: {
    key: 'SOROBAN_RPC_URL_FUTURENET',
    section: 'Stellar',
    description: 'Optional per-network RPC override for futurenet.',
    example: '',
    required: 'optional',
    schema: Joi.string().uri().allow('').default(''),
  },
  HORIZON_URL_TESTNET: {
    key: 'HORIZON_URL_TESTNET',
    section: 'Stellar',
    description: 'Optional per-network Horizon override for testnet.',
    example: '',
    required: 'optional',
    schema: Joi.string().uri().allow('').default(''),
  },
  HORIZON_URL_MAINNET: {
    key: 'HORIZON_URL_MAINNET',
    section: 'Stellar',
    description: 'Optional per-network Horizon override for mainnet.',
    example: '',
    required: 'optional',
    schema: Joi.string().uri().allow('').default(''),
  },
  HORIZON_URL_FUTURENET: {
    key: 'HORIZON_URL_FUTURENET',
    section: 'Stellar',
    description: 'Optional per-network Horizon override for futurenet.',
    example: '',
    required: 'optional',
    schema: Joi.string().uri().allow('').default(''),
  },
  CONTRACT_ID_TESTNET: {
    key: 'CONTRACT_ID_TESTNET',
    section: 'Stellar',
    description: 'Optional per-network contract override for testnet.',
    example: '',
    required: 'optional',
    schema: Joi.string().allow('').default(''),
  },
  CONTRACT_ID_MAINNET: {
    key: 'CONTRACT_ID_MAINNET',
    section: 'Stellar',
    description: 'Optional per-network contract override for mainnet.',
    example: '',
    required: 'conditional',
    schema: Joi.string().allow('').default(''),
  },
  CONTRACT_ID_FUTURENET: {
    key: 'CONTRACT_ID_FUTURENET',
    section: 'Stellar',
    description: 'Optional per-network contract override for futurenet.',
    example: '',
    required: 'optional',
    schema: Joi.string().allow('').default(''),
  },
  DEFAULT_TOKEN_CONTRACT_ID_TESTNET: {
    key: 'DEFAULT_TOKEN_CONTRACT_ID_TESTNET',
    section: 'Stellar',
    description: 'Optional per-network default token contract override for testnet.',
    example: '',
    required: 'optional',
    schema: Joi.string().allow('').default(''),
  },
  DEFAULT_TOKEN_CONTRACT_ID_MAINNET: {
    key: 'DEFAULT_TOKEN_CONTRACT_ID_MAINNET',
    section: 'Stellar',
    description: 'Optional per-network default token contract override for mainnet.',
    example: '',
    required: 'optional',
    schema: Joi.string().allow('').default(''),
  },
  DEFAULT_TOKEN_CONTRACT_ID_FUTURENET: {
    key: 'DEFAULT_TOKEN_CONTRACT_ID_FUTURENET',
    section: 'Stellar',
    description: 'Optional per-network default token contract override for futurenet.',
    example: '',
    required: 'optional',
    schema: Joi.string().allow('').default(''),
  },
  INDEXER_GAP_ALERT_THRESHOLD_LEDGERS: {
    key: 'INDEXER_GAP_ALERT_THRESHOLD_LEDGERS',
    section: 'Stellar',
    description: 'Alert when chain head minus last processed ledger exceeds this value.',
    example: '100',
    required: 'required',
    schema: Joi.number().integer().min(1).default(100),
  },
  INDEXER_GAP_ALERT_COOLDOWN_MS: {
    key: 'INDEXER_GAP_ALERT_COOLDOWN_MS',
    section: 'Stellar',
    description: 'Minimum milliseconds between repeated indexer gap alerts.',
    example: '3600000',
    required: 'required',
    schema: Joi.number().integer().min(60000).default(3600000),
  },
  IPFS_PROVIDER: {
    key: 'IPFS_PROVIDER',
    section: 'IPFS',
    description: 'IPFS provider implementation to use.',
    example: 'mock',
    required: 'required',
    schema: Joi.string().valid('mock', 'pinata').default('mock'),
  },
  PINATA_API_KEY: {
    key: 'PINATA_API_KEY',
    section: 'IPFS',
    description: 'Pinata API key when IPFS_PROVIDER=pinata.',
    example: '',
    required: 'conditional',
    secret: true,
    schema: Joi.when('IPFS_PROVIDER', {
      is: 'pinata',
      then: Joi.string().trim().min(1).required(),
      otherwise: Joi.string().allow('').default(''),
    }),
  },
  PINATA_API_SECRET: {
    key: 'PINATA_API_SECRET',
    section: 'IPFS',
    description: 'Pinata API secret when IPFS_PROVIDER=pinata.',
    example: '',
    required: 'conditional',
    secret: true,
    schema: Joi.when('IPFS_PROVIDER', {
      is: 'pinata',
      then: Joi.string().trim().min(1).required(),
      otherwise: Joi.string().allow('').default(''),
    }),
  },
  PINATA_GATEWAY_URL: {
    key: 'PINATA_GATEWAY_URL',
    section: 'IPFS',
    description: 'Gateway base URL used for Pinata-backed retrievals.',
    example: 'https://gateway.pinata.cloud/ipfs',
    required: 'required',
    schema: Joi.string().uri().default('https://gateway.pinata.cloud/ipfs'),
  },
  IPFS_MAX_FILE_SIZE: {
    key: 'IPFS_MAX_FILE_SIZE',
    section: 'IPFS',
    description: 'Maximum allowed IPFS upload size in bytes.',
    example: '52428800',
    required: 'required',
    schema: Joi.number().integer().min(1).default(52428800),
  },
  IPFS_MIN_FILE_SIZE: {
    key: 'IPFS_MIN_FILE_SIZE',
    section: 'IPFS',
    description: 'Minimum allowed IPFS upload size in bytes.',
    example: '1',
    required: 'required',
    schema: Joi.number().integer().min(1).default(1),
  },
  IPFS_STRIP_EXIF: {
    key: 'IPFS_STRIP_EXIF',
    section: 'IPFS',
    description: 'Strip EXIF metadata from supported uploads before pinning.',
    example: 'true',
    required: 'required',
    schema: Joi.boolean().default(true),
  },
  IPFS_GATEWAY: {
    key: 'IPFS_GATEWAY',
    section: 'IPFS',
    description: 'Public gateway base used for viewing claim evidence.',
    example: 'https://ipfs.io',
    required: 'required',
    schema: Joi.string().uri().default('https://ipfs.io'),
  },
  ALLOWED_IPFS_GATEWAYS: {
    key: 'ALLOWED_IPFS_GATEWAYS',
    section: 'IPFS',
    description:
      'Comma-separated list of allowed IPFS gateway hostnames for evidence URL validation. ' +
      'Defaults to the built-in list when empty. Changes take effect on next deploy (no restart needed for env-only changes).',
    example: 'ipfs.io,cloudflare-ipfs.com,gateway.pinata.cloud,dweb.link,nftstorage.link',
    required: 'optional',
    schema: Joi.string().allow('').default(''),
  },
  IPFS_PROJECT_ID: {
    key: 'IPFS_PROJECT_ID',
    section: 'IPFS',
    description: 'Legacy IPFS project identifier kept for compatibility.',
    example: '',
    required: 'optional',
    secret: true,
    schema: Joi.string().allow('').default(''),
  },
  IPFS_PROJECT_SECRET: {
    key: 'IPFS_PROJECT_SECRET',
    section: 'IPFS',
    description: 'Legacy IPFS project secret kept for compatibility.',
    example: '',
    required: 'optional',
    secret: true,
    schema: Joi.string().allow('').default(''),
  },
  JWT_SECRET: {
    key: 'JWT_SECRET',
    section: 'Auth',
    description: 'HMAC signing secret for user/admin JWTs. Rotate independently per environment.',
    example: 'replace-with-64-byte-base64url-key',
    required: 'required',
    secret: true,
    schema: Joi.string()
      .min(32)
      .required()
      .custom((value: string, helpers) =>
        rejectProductionPlaceholder(
          value,
          helpers,
          ['replace-with-64-byte-base64url-key', 'dev-secret-change-in-production'],
          'JWT_SECRET must be rotated away from the example/development value before production deploys',
        ),
      ),
  },
  JWT_EXPIRES_IN: {
    key: 'JWT_EXPIRES_IN',
    section: 'Auth',
    description: 'JWT access token lifetime.',
    example: '7d',
    required: 'required',
    schema: durationSchema.default('7d'),
  },
  JWT_REFRESH_EXPIRES_IN: {
    key: 'JWT_REFRESH_EXPIRES_IN',
    section: 'Auth',
    description: 'Refresh token lifetime for legacy auth surfaces.',
    example: '30d',
    required: 'required',
    schema: durationSchema.default('30d'),
  },
  JWT_ISSUER: {
    key: 'JWT_ISSUER',
    section: 'Auth',
    description: 'JWT issuer claim.',
    example: 'niffyinsure',
    required: 'required',
    schema: Joi.string().min(1).default('niffyinsure'),
  },
  JWT_AUDIENCE: {
    key: 'JWT_AUDIENCE',
    section: 'Auth',
    description: 'JWT audience claim.',
    example: 'niffyinsure-api',
    required: 'required',
    schema: Joi.string().min(1).default('niffyinsure-api'),
  },
  ADMIN_TOKEN: {
    key: 'ADMIN_TOKEN',
    section: 'Auth',
    description: 'Bootstrap/admin automation token used by operational surfaces.',
    example: 'replace-with-long-random-admin-token',
    required: 'required',
    secret: true,
    schema: Joi.string()
      .min(24)
      .required()
      .custom((value: string, helpers) =>
        rejectProductionPlaceholder(
          value,
          helpers,
          ['replace-with-long-random-admin-token', 'admin-token-for-cli'],
          'ADMIN_TOKEN must be rotated away from the example/development value before production deploys',
        ),
      ),
  },
  AUTH_DOMAIN: {
    key: 'AUTH_DOMAIN',
    section: 'Auth',
    description: 'Human-readable domain embedded in wallet challenge messages.',
    example: 'app.niffyinsure.local',
    required: 'required',
    schema: Joi.string().min(1).default('niffyinsure.local'),
  },
  NONCE_TTL_SECONDS: {
    key: 'NONCE_TTL_SECONDS',
    section: 'Auth',
    description: 'Wallet login challenge lifetime in seconds.',
    example: '300',
    required: 'required',
    schema: Joi.number().integer().min(60).default(300),
  },
  FRONTEND_ORIGINS: {
    key: 'FRONTEND_ORIGINS',
    section: 'HTTP',
    description: 'Comma-separated public frontend origins allowed by CORS.',
    example: 'http://localhost:3001',
    required: 'required',
    schema: frontendOriginsSchema,
  },
  ADMIN_CORS_ORIGINS: {
    key: 'ADMIN_CORS_ORIGINS',
    section: 'HTTP',
    description: 'Comma-separated admin UI origins allowed by CORS.',
    example: 'http://localhost:3002',
    required: 'optional',
    schema: Joi.string().allow('').default(''),
  },
  LOG_LEVEL: {
    key: 'LOG_LEVEL',
    section: 'Observability',
    description: 'Minimum application log level.',
    example: 'info',
    required: 'required',
    schema: Joi.string().valid('error', 'warn', 'log', 'verbose', 'debug').default('info'),
  },
  CACHE_TTL_SECONDS: {
    key: 'CACHE_TTL_SECONDS',
    section: 'Caching',
    description: 'Default cache TTL in seconds for cache-backed reads.',
    example: '60',
    required: 'required',
    schema: Joi.number().integer().min(1).default(60),
  },
  QUOTE_SIMULATION_CACHE_ENABLED: {
    key: 'QUOTE_SIMULATION_CACHE_ENABLED',
    section: 'Caching',
    description: 'Enable Redis caching for successful quote simulations.',
    example: 'true',
    required: 'required',
    schema: Joi.string().valid('true', 'false', '1', '0').default('true'),
  },
  QUOTE_SIMULATION_CACHE_TTL_SECONDS: {
    key: 'QUOTE_SIMULATION_CACHE_TTL_SECONDS',
    section: 'Caching',
    description: 'TTL for cached quote simulation results in seconds.',
    example: '30',
    required: 'required',
    schema: Joi.number().integer().min(1).max(600).default(30),
  },
  CAPTCHA_PROVIDER: {
    key: 'CAPTCHA_PROVIDER',
    section: 'Support',
    description: 'CAPTCHA provider for public support/contact forms.',
    example: 'turnstile',
    required: 'required',
    schema: Joi.string().valid('turnstile', 'hcaptcha').default('turnstile'),
  },
  CAPTCHA_SECRET_KEY: {
    key: 'CAPTCHA_SECRET_KEY',
    section: 'Support',
    description: 'Server-side CAPTCHA verification secret.',
    example: 'dev-skip',
    required: 'required',
    secret: true,
    schema: Joi.string()
      .min(1)
      .required()
      .custom((value: string, helpers) =>
        rejectProductionPlaceholder(
          value,
          helpers,
          ['dev-skip'],
          'CAPTCHA_SECRET_KEY cannot use the development bypass value in production',
        ),
      ),
  },
  CAPTCHA_SITE_KEY: {
    key: 'CAPTCHA_SITE_KEY',
    section: 'Support',
    description: 'Public CAPTCHA site key exposed to the frontend.',
    example: '',
    required: 'optional',
    schema: Joi.string().allow('').default(''),
  },
  IP_HASH_SALT: {
    key: 'IP_HASH_SALT',
    section: 'Support',
    description: 'Salt used when hashing IP addresses for privacy-safe deduplication.',
    example: 'replace-with-random-hex',
    required: 'required',
    secret: true,
    schema: Joi.string()
      .min(16)
      .required()
      .custom((value: string, helpers) =>
        rejectProductionPlaceholder(
          value,
          helpers,
          ['replace-with-random-hex', 'niff-salt'],
          'IP_HASH_SALT must be rotated away from the example/development value before production deploys',
        ),
      ),
  },
  TENANT_RESOLUTION_ENABLED: {
    key: 'TENANT_RESOLUTION_ENABLED',
    section: 'Multi-tenancy',
    description: 'Enable tenant resolution from hostnames/headers.',
    example: 'false',
    required: 'required',
    schema: Joi.boolean().default(false),
  },
  TENANT_BASE_DOMAIN: {
    key: 'TENANT_BASE_DOMAIN',
    section: 'Multi-tenancy',
    description: 'Base domain used for subdomain-based tenant resolution.',
    example: 'niffyinsur.com',
    required: 'required',
    schema: Joi.string().default('niffyinsur.com'),
  },
  DATA_RETENTION_DAYS: {
    key: 'DATA_RETENTION_DAYS',
    section: 'Operations',
    description: 'Days to retain soft-deleted rows before purge jobs hard-delete them.',
    example: '730',
    required: 'required',
    schema: Joi.number().integer().min(1).default(730),
  },
  DB_POOL_MAX: {
    key: 'DB_POOL_MAX',
    section: 'Database',
    description: 'Maximum Prisma connection pool size.',
    example: '10',
    required: 'required',
    schema: Joi.number().integer().min(1).default(10),
  },
  DB_POOL_MIN: {
    key: 'DB_POOL_MIN',
    section: 'Database',
    description: 'Minimum warm Prisma connections.',
    example: '2',
    required: 'required',
    schema: Joi.number().integer().min(0).default(2),
  },
  DB_POOL_IDLE_TIMEOUT_MS: {
    key: 'DB_POOL_IDLE_TIMEOUT_MS',
    section: 'Database',
    description: 'Idle connection reclaim timeout in milliseconds.',
    example: '30000',
    required: 'required',
    schema: Joi.number().integer().min(1000).default(30000),
  },
  DB_POOL_CONNECTION_TIMEOUT_MS: {
    key: 'DB_POOL_CONNECTION_TIMEOUT_MS',
    section: 'Database',
    description: 'Maximum time to wait for a free DB connection in milliseconds.',
    example: '5000',
    required: 'required',
    schema: Joi.number().integer().min(500).default(5000),
  },
  DB_SLOW_QUERY_MS: {
    key: 'DB_SLOW_QUERY_MS',
    section: 'Database',
    description: 'Warn when an individual DB query exceeds this latency threshold.',
    example: '250',
    required: 'required',
    schema: Joi.number().integer().min(10).default(250),
  },
  GRAPHQL_ENABLED: {
    key: 'GRAPHQL_ENABLED',
    section: 'GraphQL',
    description: 'Enable the GraphQL endpoint.',
    example: 'true',
    required: 'required',
    schema: Joi.boolean().default(true),
  },
  GRAPHQL_PATH: {
    key: 'GRAPHQL_PATH',
    section: 'GraphQL',
    description: 'HTTP path mounted for GraphQL requests.',
    example: '/graphql',
    required: 'required',
    schema: Joi.string().default('/graphql'),
  },
  GRAPHQL_INTROSPECTION_IN_PRODUCTION: {
    key: 'GRAPHQL_INTROSPECTION_IN_PRODUCTION',
    section: 'GraphQL',
    description: 'Allow GraphQL schema introspection when NODE_ENV=production.',
    example: 'false',
    required: 'required',
    schema: Joi.boolean().default(false),
  },
  GRAPHQL_MAX_DEPTH: {
    key: 'GRAPHQL_MAX_DEPTH',
    section: 'GraphQL',
    description: 'Maximum allowed GraphQL selection depth.',
    example: '8',
    required: 'required',
    schema: Joi.number().integer().min(1).default(8),
  },
  GRAPHQL_MAX_COMPLEXITY: {
    key: 'GRAPHQL_MAX_COMPLEXITY',
    section: 'GraphQL',
    description: 'Maximum estimated GraphQL query complexity.',
    example: '250',
    required: 'required',
    schema: Joi.number().integer().min(1).default(250),
  },
  GRAPHQL_RATE_LIMIT_MAX: {
    key: 'GRAPHQL_RATE_LIMIT_MAX',
    section: 'GraphQL',
    description: 'Maximum GraphQL operations allowed per rate-limit window.',
    example: '60',
    required: 'required',
    schema: Joi.number().integer().min(1).default(60),
  },
  GRAPHQL_RATE_LIMIT_WINDOW_MS: {
    key: 'GRAPHQL_RATE_LIMIT_WINDOW_MS',
    section: 'GraphQL',
    description: 'GraphQL rate-limit window in milliseconds.',
    example: '60000',
    required: 'required',
    schema: Joi.number().integer().min(1000).default(60000),
  },
  GRAPHQL_SLOW_OPERATION_MS: {
    key: 'GRAPHQL_SLOW_OPERATION_MS',
    section: 'GraphQL',
    description: 'Warn when a GraphQL operation exceeds this latency threshold.',
    example: '750',
    required: 'required',
    schema: Joi.number().integer().min(10).default(750),
  },
  GRAPHQL_PERSISTED_QUERIES_ENABLED: {
    key: 'GRAPHQL_PERSISTED_QUERIES_ENABLED',
    section: 'GraphQL',
    description: 'Enable Apollo-style automatic persisted queries.',
    example: 'false',
    required: 'required',
    schema: Joi.boolean().default(false),
  },
  GRAPHQL_PERSISTED_QUERY_TTL_SECONDS: {
    key: 'GRAPHQL_PERSISTED_QUERY_TTL_SECONDS',
    section: 'GraphQL',
    description: 'Persisted GraphQL query cache TTL in seconds.',
    example: '86400',
    required: 'required',
    schema: Joi.number().integer().min(60).default(86400),
  },
  GRAPHQL_POLICY_CLAIMS_DEFAULT_LIMIT: {
    key: 'GRAPHQL_POLICY_CLAIMS_DEFAULT_LIMIT',
    section: 'GraphQL',
    description: 'Default nested policy.claims page size.',
    example: '10',
    required: 'required',
    schema: Joi.number().integer().min(1).max(100).default(10),
  },
  GRAPHQL_POLICY_CLAIMS_MAX_LIMIT: {
    key: 'GRAPHQL_POLICY_CLAIMS_MAX_LIMIT',
    section: 'GraphQL',
    description: 'Maximum nested policy.claims page size.',
    example: '25',
    required: 'required',
    schema: Joi.number().integer().min(1).max(250).default(25),
  },
  HORIZON_API_KEY: {
    key: 'HORIZON_API_KEY',
    section: 'Stellar',
    description: 'Optional Horizon API key for managed providers that require one.',
    example: '',
    required: 'optional',
    secret: true,
    schema: Joi.string().allow('').default(''),
  },
  SMTP_HOST: {
    key: 'SMTP_HOST',
    section: 'Notifications',
    description: 'SMTP host for outbound email notifications.',
    example: '127.0.0.1',
    required: 'required',
    schema: Joi.string().default('127.0.0.1'),
  },
  SMTP_PORT: {
    key: 'SMTP_PORT',
    section: 'Notifications',
    description: 'SMTP port for outbound email notifications.',
    example: '1025',
    required: 'required',
    schema: Joi.number().integer().min(1).max(65535).default(1025),
  },
  SMTP_USER: {
    key: 'SMTP_USER',
    section: 'Notifications',
    description: 'SMTP username when authenticated mail delivery is enabled.',
    example: '',
    required: 'optional',
    secret: true,
    schema: Joi.string().allow('').default(''),
  },
  SMTP_PASS: {
    key: 'SMTP_PASS',
    section: 'Notifications',
    description: 'SMTP password when authenticated mail delivery is enabled.',
    example: '',
    required: 'optional',
    secret: true,
    schema: Joi.string().allow('').default(''),
  },
  SMTP_FROM: {
    key: 'SMTP_FROM',
    section: 'Notifications',
    description: 'From address used for outbound notification emails.',
    example: 'no-reply@niffyinsure.local',
    required: 'required',
    schema: Joi.string().email().default('no-reply@niffyinsure.local'),
  },
  TELEGRAM_BOT_TOKEN: {
    key: 'TELEGRAM_BOT_TOKEN',
    section: 'Notifications',
    description: 'Telegram Bot API token for optional claim notifications.',
    example: '',
    required: 'optional',
    secret: true,
    schema: Joi.string().allow('').default(''),
  },
  DISCORD_WEBHOOK_URL: {
    key: 'DISCORD_WEBHOOK_URL',
    section: 'Notifications',
    description: 'Discord webhook URL for optional claim notifications.',
    example: '',
    required: 'optional',
    secret: true,
    schema: Joi.string().uri().allow('').default(''),
  },
  FEATURE_FLAGS_JSON: {
    key: 'FEATURE_FLAGS_JSON',
    section: 'Feature flags',
    description: 'JSON object containing backend feature flags.',
    example: '{"ramp":false}',
    required: 'optional',
    schema: featureFlagsSchema.default(''),
  },
  FEATURE_FLAGS_DISABLED_STATUS: {
    key: 'FEATURE_FLAGS_DISABLED_STATUS',
    section: 'Feature flags',
    description: 'HTTP status returned when a feature flag is disabled.',
    example: '404',
    required: 'required',
    schema: Joi.string().valid('403', '404').default('404'),
  },
  RAMP_URL: {
    key: 'RAMP_URL',
    section: 'Ramp',
    description: 'Base URL for the optional fiat on-ramp integration.',
    example: '',
    required: 'optional',
    schema: Joi.string().uri().allow('').default(''),
  },
  RAMP_ALLOWED_REGIONS: {
    key: 'RAMP_ALLOWED_REGIONS',
    section: 'Ramp',
    description: 'Comma-separated ISO region codes where the on-ramp is allowed.',
    example: '',
    required: 'optional',
    schema: Joi.string().allow('').default(''),
  },
  RAMP_UTM_SOURCE: {
    key: 'RAMP_UTM_SOURCE',
    section: 'Ramp',
    description: 'UTM source appended to ramp URLs.',
    example: 'niffyinsure',
    required: 'required',
    schema: Joi.string().default('niffyinsure'),
  },
  RAMP_UTM_MEDIUM: {
    key: 'RAMP_UTM_MEDIUM',
    section: 'Ramp',
    description: 'UTM medium appended to ramp URLs.',
    example: 'app',
    required: 'required',
    schema: Joi.string().default('app'),
  },
  RAMP_UTM_CAMPAIGN: {
    key: 'RAMP_UTM_CAMPAIGN',
    section: 'Ramp',
    description: 'UTM campaign appended to ramp URLs.',
    example: 'onramp',
    required: 'required',
    schema: Joi.string().default('onramp'),
  },
  SSE_MAX_CONNECTIONS: {
    key: 'SSE_MAX_CONNECTIONS',
    section: 'Operations',
    description: 'Maximum concurrent SSE connections.',
    example: '500',
    required: 'required',
    schema: Joi.number().integer().min(1).default(500),
  },
  SOLVENCY_MONITORING_ENABLED: {
    key: 'SOLVENCY_MONITORING_ENABLED',
    section: 'Operations',
    description: 'Enable scheduled solvency monitoring.',
    example: 'true',
    required: 'required',
    schema: Joi.string().valid('true', 'false', '1', '0').default('true'),
  },
  SOLVENCY_CRON_EXPRESSION: {
    key: 'SOLVENCY_CRON_EXPRESSION',
    section: 'Operations',
    description: 'Cron expression for solvency monitoring runs.',
    example: '0 */15 * * * *',
    required: 'required',
    schema: Joi.string().default('0 */15 * * * *'),
  },
  SOLVENCY_BUFFER_THRESHOLD_STROOPS: {
    key: 'SOLVENCY_BUFFER_THRESHOLD_STROOPS',
    section: 'Operations',
    description: 'Minimum treasury buffer before solvency warnings fire.',
    example: '0',
    required: 'required',
    schema: Joi.string().pattern(/^\d+$/).default('0'),
  },
  SOLVENCY_SIMULATION_SOURCE_ACCOUNT: {
    key: 'SOLVENCY_SIMULATION_SOURCE_ACCOUNT',
    section: 'Operations',
    description: 'Optional Stellar account used for solvency simulation calls.',
    example: '',
    required: 'optional',
    schema: Joi.string().allow('').default(''),
  },
  SOLVENCY_TENANT_ID: {
    key: 'SOLVENCY_TENANT_ID',
    section: 'Operations',
    description: 'Optional tenant identifier to scope solvency monitoring.',
    example: '',
    required: 'optional',
    schema: Joi.string().allow('').default(''),
  },
  SOLVENCY_ALERT_WEBHOOK_URL: {
    key: 'SOLVENCY_ALERT_WEBHOOK_URL',
    section: 'Operations',
    description: 'Webhook URL that receives solvency alert notifications.',
    example: '',
    required: 'optional',
    secret: true,
    schema: Joi.string().uri().allow('').default(''),
  },
  SOLVENCY_ALERT_WEBHOOK_SECRET: {
    key: 'SOLVENCY_ALERT_WEBHOOK_SECRET',
    section: 'Operations',
    description: 'Shared secret sent with solvency alert webhooks.',
    example: '',
    required: 'optional',
    secret: true,
    schema: Joi.string().allow('').default(''),
  },
  WASM_DRIFT_WEBHOOK_URL: {
    key: 'WASM_DRIFT_WEBHOOK_URL',
    section: 'Operations',
    description: 'Webhook URL that receives wasm drift alerts.',
    example: '',
    required: 'optional',
    secret: true,
    schema: Joi.string().uri().allow('').default(''),
  },
  WASM_DRIFT_WEBHOOK_SECRET: {
    key: 'WASM_DRIFT_WEBHOOK_SECRET',
    section: 'Operations',
    description: 'Shared secret sent with wasm drift alerts.',
    example: '',
    required: 'optional',
    secret: true,
    schema: Joi.string().allow('').default(''),
  },
  DEPLOYMENT_REGISTRY_PATH: {
    key: 'DEPLOYMENT_REGISTRY_PATH',
    section: 'Operations',
    description: 'Path to the contract deployment registry JSON file.',
    example: 'contracts/deployment-registry.json',
    required: 'required',
    schema: Joi.string().default('contracts/deployment-registry.json'),
  },
  NIFFYINSURE_EXPECTED_WASM_HASH: {
    key: 'NIFFYINSURE_EXPECTED_WASM_HASH',
    section: 'Operations',
    description: 'Expected SHA-256 hash of the authorised niffyinsure wasm artifact.',
    example: '',
    required: 'optional',
    schema: Joi.string().allow('').default(''),
  },
  WEBHOOK_SECRET_GITHUB: {
    key: 'WEBHOOK_SECRET_GITHUB',
    section: 'Webhooks',
    description: 'GitHub webhook secret for signature verification.',
    example: '',
    required: 'optional',
    secret: true,
    schema: Joi.string().allow('').default(''),
  },
  WEBHOOK_SECRET_STRIPE: {
    key: 'WEBHOOK_SECRET_STRIPE',
    section: 'Webhooks',
    description: 'Stripe webhook secret for signature verification.',
    example: '',
    required: 'optional',
    secret: true,
    schema: Joi.string().allow('').default(''),
  },
  WEBHOOK_SECRET_GENERIC: {
    key: 'WEBHOOK_SECRET_GENERIC',
    section: 'Webhooks',
    description: 'Generic webhook secret for signature verification.',
    example: '',
    required: 'optional',
    secret: true,
    schema: Joi.string().allow('').default(''),
  },
  WEBHOOK_IP_ALLOWLIST_GITHUB: {
    key: 'WEBHOOK_IP_ALLOWLIST_GITHUB',
    section: 'Webhooks',
    description: 'Optional comma-separated IP allowlist for GitHub webhooks.',
    example: '',
    required: 'optional',
    schema: Joi.string().allow('').default(''),
  },
  WEBHOOK_IP_ALLOWLIST_STRIPE: {
    key: 'WEBHOOK_IP_ALLOWLIST_STRIPE',
    section: 'Webhooks',
    description: 'Optional comma-separated IP allowlist for Stripe webhooks.',
    example: '',
    required: 'optional',
    schema: Joi.string().allow('').default(''),
  },
  WEBHOOK_IP_ALLOWLIST_GENERIC: {
    key: 'WEBHOOK_IP_ALLOWLIST_GENERIC',
    section: 'Webhooks',
    description: 'Optional comma-separated IP allowlist for generic webhooks.',
    example: '',
    required: 'optional',
    schema: Joi.string().allow('').default(''),
  },
  PAGINATION_HMAC_SECRET: {
    key: 'PAGINATION_HMAC_SECRET',
    section: 'Auth',
    description: 'HMAC secret for tamper-resistant pagination cursors.',
    example: '',
    required: 'optional',
    secret: true,
    schema: Joi.string().allow('').default(''),
  },
  DISABLE_REINDEX_WORKER: {
    key: 'DISABLE_REINDEX_WORKER',
    section: 'Operations',
    description: 'Disable the legacy reindex worker in environments where it should not start.',
    example: '0',
    required: 'required',
    schema: Joi.string().valid('0', '1').default('0'),
  },
  RENEWAL_REMINDER_CRON: {
    key: 'RENEWAL_REMINDER_CRON',
    section: 'Operations',
    description: 'Cron expression for renewal reminder background jobs.',
    example: '0 * * * *',
    required: 'required',
    schema: Joi.string().default('0 * * * *'),
  },
  JWT_SECRET_NEXT: {
    key: 'JWT_SECRET_NEXT',
    section: 'Auth',
    description:
      'Incoming JWT signing key for zero-downtime rotation overlap. ' +
      'Set to the new key while JWT_SECRET still holds the current key. ' +
      'Tokens signed by either key are accepted during the overlap window. ' +
      'Remove after all tokens signed with the old JWT_SECRET have expired.',
    example: '',
    required: 'optional',
    secret: true,
    schema: Joi.string().min(32).allow('').default(''),
  },
};

export const ENV_KEYS = Object.keys(ENV_DEFINITIONS) as EnvKey[];

export function buildValidationSchema(): Joi.ObjectSchema<EnvironmentVariables> {
  const shape = Object.fromEntries(
    ENV_KEYS.map((key) => [key, ENV_DEFINITIONS[key].schema]),
  ) as Record<string, Joi.Schema>;

  return Joi.object(shape) as Joi.ObjectSchema<EnvironmentVariables>;
}

export function renderEnvExample(): string {
  const header = [
    '# Backend environment variables for NiffyInsure',
    '#',
    '# Source of truth: backend/src/config/env.definitions.ts',
    '# Generate/update: npm run env:example:generate',
    '# Verify drift: npm run env:example:check',
    '#',
    '# Secrets must be distinct per environment (development, staging, production).',
    '# Store production values in your secrets manager, not in this file.',
    '# Example secret backends: HashiCorp Vault, AWS SSM Parameter Store / Secrets Manager, Kubernetes Secrets.',
    '#',
    '# Requirement labels:',
    '#   required    = application boot should fail if missing',
    '#   optional    = only needed when the related feature/integration is enabled',
    '#   conditional = required when another setting enables that integration',
    '',
  ];

  const sections = new Map<string, EnvDefinition[]>();
  for (const key of ENV_KEYS) {
    const definition = ENV_DEFINITIONS[key];
    const bucket = sections.get(definition.section) ?? [];
    bucket.push(definition);
    sections.set(definition.section, bucket);
  }

  const body: string[] = [];
  for (const [section, definitions] of sections.entries()) {
    body.push(`# ${section}`);
    for (const definition of definitions) {
      body.push(
        `# [${definition.required}] ${definition.description}${
          definition.secret ? ' Store in a secrets manager.' : ''
        }`,
      );
      body.push(`${definition.key}=${definition.example}`);
      body.push('');
    }
  }

  return [...header, ...body].join('\n').trimEnd() + '\n';
}
