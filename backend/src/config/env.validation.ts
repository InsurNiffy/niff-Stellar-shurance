import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().required().description('PostgreSQL connection URL'),
  REDIS_URL: Joi.string().required().description('Redis connection URL'),
  SOROBAN_RPC_URL: Joi.string().required().description('Soroban RPC endpoint'),
  // IPFS Configuration
  IPFS_PROVIDER: Joi.string()
    .valid('mock', 'pinata')
    .default('mock')
    .description('IPFS provider to use'),
  PINATA_API_KEY: Joi.string().allow('').description('Pinata API key'),
  PINATA_API_SECRET: Joi.string().allow('').description('Pinata API secret'),
  PINATA_GATEWAY_URL: Joi.string()
    .default('https://gateway.pinata.cloud/ipfs')
    .description('Pinata gateway URL'),
  IPFS_MAX_FILE_SIZE: Joi.number()
    .default(52428800)
    .description('Maximum file size in bytes (default: 50MB)'),
  IPFS_MIN_FILE_SIZE: Joi.number()
    .default(1)
    .description('Minimum file size in bytes'),
  IPFS_STRIP_EXIF: Joi.boolean()
    .default(true)
    .description('Strip EXIF metadata from images'),
  // Legacy IPFS config (kept for compatibility)
  IPFS_GATEWAY: Joi.string().default('https://ipfs.io'),
  IPFS_PROJECT_ID: Joi.string().allow(''),
  IPFS_PROJECT_SECRET: Joi.string().allow(''),
  // Auth
  JWT_SECRET: Joi.string().min(32).required(),
  ADMIN_TOKEN: Joi.string().required(),
  // Logging
  LOG_LEVEL: Joi.string()
    .default('info')
    .valid('error', 'warn', 'log', 'verbose', 'debug'),
  // Cache
  CACHE_TTL_SECONDS: Joi.number().default(60).description('Cache TTL in seconds'),
});

