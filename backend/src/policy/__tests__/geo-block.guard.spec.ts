/**
 * Tests for GeoBlockGuard.
 *
 * Verifies:
 *   - Requests from a blocked country are rejected with 451.
 *   - Requests from an allowed country pass.
 *   - A missing geo header defaults to allow (no false positives).
 */

import { ExecutionContext, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeoBlockGuard } from '../geo-block.guard';

function makeContext(headers: Record<string, string>): ExecutionContext {
  const request = { headers };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

function makeConfigService(blockedCountries: string): ConfigService {
  return { get: () => blockedCountries } as unknown as ConfigService;
}

describe('GeoBlockGuard', () => {
  it('rejects requests from a blocked country with 451', () => {
    const guard = new GeoBlockGuard(makeConfigService('KP,IR,CU'));
    const ctx = makeContext({ 'cf-ipcountry': 'IR' });

    expect(() => guard.canActivate(ctx)).toThrow(HttpException);
    try {
      guard.canActivate(ctx);
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(451);
    }
  });

  it('allows requests from a non-blocked country', () => {
    const guard = new GeoBlockGuard(makeConfigService('KP,IR,CU'));
    const ctx = makeContext({ 'cf-ipcountry': 'US' });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows requests with no geo header (no false positives)', () => {
    const guard = new GeoBlockGuard(makeConfigService('KP,IR,CU'));
    const ctx = makeContext({});

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('falls back to X-Country-Code when CF-IPCountry is absent', () => {
    const guard = new GeoBlockGuard(makeConfigService('KP,IR,CU'));
    const ctx = makeContext({ 'x-country-code': 'kp' });

    expect(() => guard.canActivate(ctx)).toThrow(HttpException);
  });

  it('allows all requests when BLOCKED_COUNTRIES is empty', () => {
    const guard = new GeoBlockGuard(makeConfigService(''));
    const ctx = makeContext({ 'cf-ipcountry': 'IR' });

    expect(guard.canActivate(ctx)).toBe(true);
  });
});
