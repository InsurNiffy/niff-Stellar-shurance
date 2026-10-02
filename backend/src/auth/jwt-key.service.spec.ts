import { JwtKeyService } from './jwt-key.service';
import { ConfigService } from '@nestjs/config';

function makeService(env: Record<string, string>): JwtKeyService {
  const config = {
    get: <T>(key: string, fallback?: T): T =>
      (env[key] as unknown as T) ?? fallback as T,
  } as ConfigService;
  return new JwtKeyService(config);
}

describe('JwtKeyService', () => {
  it('returns the current signing key', () => {
    const svc = makeService({ JWT_SECRET: 'secret-current', JWT_KEY_ID: 'v2' });
    expect(svc.signingKey).toEqual({ kid: 'v2', secret: 'secret-current' });
  });

  it('defaults kid to v1 when JWT_KEY_ID is unset', () => {
    const svc = makeService({ JWT_SECRET: 'secret-current' });
    expect(svc.signingKey.kid).toBe('v1');
  });

  it('resolves secret for current kid', () => {
    const svc = makeService({ JWT_SECRET: 'new-secret', JWT_KEY_ID: 'v2' });
    expect(svc.secretForKid('v2')).toBe('new-secret');
  });

  it('resolves secret for previous kid during rotation', () => {
    const svc = makeService({
      JWT_SECRET: 'new-secret',
      JWT_KEY_ID: 'v2',
      JWT_SECRET_PREV: 'old-secret',
      JWT_KEY_ID_PREV: 'v1',
    });
    expect(svc.secretForKid('v1')).toBe('old-secret');
    expect(svc.secretForKid('v2')).toBe('new-secret');
  });

  it('returns null for unknown kid', () => {
    const svc = makeService({ JWT_SECRET: 'secret', JWT_KEY_ID: 'v2' });
    expect(svc.secretForKid('v99')).toBeNull();
  });

  it('acceptedSecrets includes only current when no previous key', () => {
    const svc = makeService({ JWT_SECRET: 'secret-a', JWT_KEY_ID: 'v1' });
    expect(svc.acceptedSecrets()).toEqual(['secret-a']);
  });

  it('acceptedSecrets includes both during rotation', () => {
    const svc = makeService({
      JWT_SECRET: 'secret-new',
      JWT_KEY_ID: 'v2',
      JWT_SECRET_PREV: 'secret-old',
      JWT_KEY_ID_PREV: 'v1',
    });
    expect(svc.acceptedSecrets()).toEqual(['secret-new', 'secret-old']);
  });
});
