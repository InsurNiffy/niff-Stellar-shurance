import { buildValidationSchema, EnvironmentVariables } from './env.definitions';

export const validationSchema = buildValidationSchema();

function formatValidationMessage(message: string): string {
  return message.replace(/["]/g, '');
}

export function validateEnvironment(
  input: Record<string, unknown>,
): EnvironmentVariables {
  const { error, value } = validationSchema.validate(input, {
    abortEarly: false,
    allowUnknown: true,
    convert: true,
  });

  if (!error) {
    return value;
  }

  const details = error.details.map((detail) => formatValidationMessage(detail.message));
  throw new Error(
    ['Environment validation failed:', ...details.map((detail) => `- ${detail}`)].join('\n'),
  );
}
