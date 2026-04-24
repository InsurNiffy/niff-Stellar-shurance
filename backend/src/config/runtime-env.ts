import { EnvironmentVariables } from './env.definitions';
import { validateEnvironment } from './env.validation';

let cachedEnv: EnvironmentVariables | null = null;

export function getRuntimeEnv(): EnvironmentVariables {
  if (!cachedEnv) {
    cachedEnv = validateEnvironment(process.env);
  }

  return cachedEnv;
}

export function resetRuntimeEnvForTests(): void {
  cachedEnv = null;
}
