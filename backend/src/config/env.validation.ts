import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  CORS_ORIGIN: Joi.string().default('*'),
  API_DEFAULT_VERSION: Joi.string().default('1'),
  DATABASE_URL: Joi.string().uri().required(),
  JWT_SECRET: Joi.string().min(16).required(),
  STELLAR_NETWORK: Joi.string()
    .valid('testnet', 'mainnet', 'futurenet')
    .default('testnet'),
  STELLAR_HORIZON_URL: Joi.string().uri().default('https://horizon-testnet.stellar.org'),
  STELLAR_SOROBAN_RPC_URL: Joi.string().uri().default('https://soroban-testnet.stellar.org'),
  CONTRACT_ID: Joi.string().required(),
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'debug', 'verbose')
    .default('info'),
})
  .unknown(true)
  .prefs({ abortEarly: false });

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const { error, value } = envValidationSchema.validate(config, {
    allowUnknown: true,
    abortEarly: false,
  });

  if (error) {
    const details = error.details.map((d) => d.message).join('; ');
    throw new Error(`Environment validation failed: ${details}`);
  }

  return value as Record<string, unknown>;
}
