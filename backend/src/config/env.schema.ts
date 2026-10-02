import { z } from 'zod';

const StellarNetwork = z.enum(['testnet', 'mainnet', 'futurenet', 'local']);

const secretStr = (key: string) =>
  z
    .string({ required_error: `${key} is required` })
    .min(1, `${key} must not be empty`);

export const envSchema = z.object({
  // ── Runtime ───────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  // ── Database ──────────────────────────────────────────────────────────────
  DATABASE_URL: secretStr('DATABASE_URL'),

  // ── Cache ─────────────────────────────────────────────────────────────────
  REDIS_URL: secretStr('REDIS_URL'),

  // ── Stellar / Soroban ─────────────────────────────────────────────────────
  STELLAR_NETWORK: StellarNetwork.default('testnet'),
  SOROBAN_RPC_URL: z.string().url().optional(),
  SOROBAN_SIMULATE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  HORIZON_URL: z.string().url().optional(),
  STELLAR_NETWORK_PASSPHRASE: z.string().optional(),
  CONTRACT_ID: z.string().optional(),
  DEFAULT_TOKEN_CONTRACT_ID: z.string().optional(),

  // Per-network overrides (used in CI)
  SOROBAN_RPC_URL_TESTNET: z.string().url().optional(),
  SOROBAN_RPC_URL_MAINNET: z.string().url().optional(),
  SOROBAN_RPC_URL_FUTURENET: z.string().url().optional(),
  HORIZON_URL_TESTNET: z.string().url().optional(),
  HORIZON_URL_MAINNET: z.string().url().optional(),
  HORIZON_URL_FUTURENET: z.string().url().optional(),
  CONTRACT_ID_TESTNET: z.string().optional(),
  CONTRACT_ID_MAINNET: z.string().optional(),
  CONTRACT_ID_FUTURENET: z.string().optional(),
  DEFAULT_TOKEN_CONTRACT_ID_TESTNET: z.string().optional(),
  DEFAULT_TOKEN_CONTRACT_ID_MAINNET: z.string().optional(),
  DEFAULT_TOKEN_CONTRACT_ID_FUTURENET: z.string().optional(),

  // ── JWT / Auth ────────────────────────────────────────────────────────────
  JWT_SECRET: secretStr('JWT_SECRET'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  JWT_ISSUER: z.string().default('niff-stellar-shurance'),
  JWT_AUDIENCE: z.string().default('niff-stellar-shurance-clients'),
  ADMIN_TOKEN: z.string().optional(),
  AUTH_DOMAIN: z.string().default('localhost'),
  NONCE_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  // ── CORS / Geo ────────────────────────────────────────────────────────────
  FRONTEND_ORIGINS: z.string().default(''),
  ADMIN_CORS_ORIGINS: z.string().default(''),
  CORS_ALLOWED_ORIGINS: z.string().default(''),
  BLOCKED_COUNTRIES: z.string().default(''),

  // ── SMTP ──────────────────────────────────────────────────────────────────
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default(''),

  // ── IPFS ──────────────────────────────────────────────────────────────────
  IPFS_PROVIDER: z.enum(['mock', 'pinata']).default('mock'),
  PINATA_API_KEY: z.string().default(''),
  PINATA_API_SECRET: z.string().default(''),
  PINATA_GATEWAY_URL: z.string().default(''),
  IPFS_MAX_FILE_SIZE: z.coerce.number().int().positive().default(10_485_760),
  IPFS_MIN_FILE_SIZE: z.coerce.number().int().nonnegative().default(0),
  IPFS_STRIP_EXIF: z
    .string()
    .transform((v) => v === 'true' || v === '1')
    .default('false'),
  IPFS_GATEWAY: z.string().default(''),
  ALLOWED_IPFS_GATEWAYS: z.string().default(''),
  IPFS_PROJECT_ID: z.string().default(''),
  IPFS_PROJECT_SECRET: z.string().default(''),

  // ── Logging ───────────────────────────────────────────────────────────────
  LOG_LEVEL: z.enum(['error', 'warn', 'log', 'verbose', 'debug']).default('log'),

  // ── Indexer ───────────────────────────────────────────────────────────────
  INDEXER_GAP_ALERT_THRESHOLD_LEDGERS: z.coerce.number().int().positive().default(100),
  INDEXER_GAP_ALERT_COOLDOWN_MS: z.coerce.number().int().positive().default(300_000),
  INDEXER_BATCH_SIZE: z.coerce.number().int().positive().default(50),
  MAX_BACKFILL_LEDGER_RANGE: z.coerce.number().int().positive().default(10_000),

  // ── Cache TTL ─────────────────────────────────────────────────────────────
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
}).superRefine((data, ctx) => {
  if (data.STELLAR_NETWORK === 'mainnet') {
    const required: (keyof typeof data)[] = [
      'CONTRACT_ID',
      'DEFAULT_TOKEN_CONTRACT_ID',
      'SOROBAN_RPC_URL',
      'HORIZON_URL',
    ];
    for (const key of required) {
      if (!data[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required when STELLAR_NETWORK=mainnet`,
        });
      }
    }
  }
});

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(raw: Record<string, unknown>): AppEnv {
  const result = envSchema.safeParse(raw);
  if (result.success) return result.data;

  const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
  throw new Error(`Environment validation failed:\n${lines.join('\n')}`);
}
