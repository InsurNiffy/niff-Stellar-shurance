/**
 * CaptchaService integration tests — #410
 *
 * Covers:
 *   - Valid token accepted
 *   - Invalid token rejected
 *   - Network error returns false (fail closed)
 *   - dev-skip mode bypasses verification
 *   - hCaptcha provider URL is used when configured
 */

import axios from 'axios';
import { CaptchaService } from './captcha.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function makeService(overrides: Record<string, string> = {}): CaptchaService {
  const defaults: Record<string, string> = {
    CAPTCHA_SECRET_KEY: 'test-secret',
    CAPTCHA_PROVIDER: 'turnstile',
    ...overrides,
  };
  const configService = {
    get: jest.fn((key: string, fallback?: unknown) => defaults[key] ?? fallback),
  } as never;
  return new CaptchaService(configService);
}

describe('CaptchaService', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns true when provider responds success=true', async () => {
    mockedAxios.post = jest.fn().mockResolvedValue({ data: { success: true } });
    const svc = makeService();
    expect(await svc.verify('valid-token', '1.2.3.4')).toBe(true);
  });

  it('returns false when provider responds success=false', async () => {
    mockedAxios.post = jest.fn().mockResolvedValue({ data: { success: false } });
    const svc = makeService();
    expect(await svc.verify('bad-token')).toBe(false);
  });

  it('returns false on network error (fail closed)', async () => {
    mockedAxios.post = jest.fn().mockRejectedValue(new Error('network error'));
    const svc = makeService();
    expect(await svc.verify('any-token')).toBe(false);
  });

  it('skips verification and returns true when secret is dev-skip', async () => {
    const svc = makeService({ CAPTCHA_SECRET_KEY: 'dev-skip' });
    expect(await svc.verify('any-token')).toBe(true);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('skips verification and returns true when no secret is configured', async () => {
    const svc = makeService({ CAPTCHA_SECRET_KEY: '' });
    expect(await svc.verify('any-token')).toBe(true);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('calls hCaptcha URL when provider=hcaptcha', async () => {
    mockedAxios.post = jest.fn().mockResolvedValue({ data: { success: true } });
    const svc = makeService({ CAPTCHA_PROVIDER: 'hcaptcha' });
    await svc.verify('token');
    expect((mockedAxios.post as jest.Mock).mock.calls[0][0]).toContain('hcaptcha.com');
  });

  it('calls Turnstile URL when provider=turnstile', async () => {
    mockedAxios.post = jest.fn().mockResolvedValue({ data: { success: true } });
    const svc = makeService({ CAPTCHA_PROVIDER: 'turnstile' });
    await svc.verify('token');
    expect((mockedAxios.post as jest.Mock).mock.calls[0][0]).toContain('cloudflare.com');
  });

  it('includes remoteip in request body when provided', async () => {
    mockedAxios.post = jest.fn().mockResolvedValue({ data: { success: true } });
    const svc = makeService();
    await svc.verify('token', '10.0.0.1');
    const body: string = (mockedAxios.post as jest.Mock).mock.calls[0][1];
    expect(body).toContain('remoteip=10.0.0.1');
  });

  it('rejects submission without valid captcha token (service layer)', async () => {
    mockedAxios.post = jest.fn().mockResolvedValue({ data: { success: false } });
    const svc = makeService();
    const result = await svc.verify('');
    expect(result).toBe(false);
  });
});
