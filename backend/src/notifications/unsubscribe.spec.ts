/**
 * #1483 — RFC 8058 unsubscribe tokens and headers.
 */
import {
  buildUnsubscribeHeaders,
  buildUnsubscribeUrl,
  ONE_CLICK_HEADER_VALUE,
  resolveUnsubscribeSecret,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from './unsubscribe';

describe('unsubscribe tokens', () => {
  it('round-trips a signed payload', () => {
    const token = signUnsubscribeToken(
      { userId: 'GABC', channel: 'email', scope: 'claim_update' },
      'secret',
      1_700_000_000,
    );
    const payload = verifyUnsubscribeToken(token, 'secret', 1_700_000_100);
    expect(payload).toMatchObject({
      userId: 'GABC',
      channel: 'email',
      scope: 'claim_update',
    });
    expect(payload!.exp).toBe(1_700_000_000 + 60 * 60 * 24 * 30);
  });

  it('rejects tampered payloads', () => {
    const token = signUnsubscribeToken({ userId: 'GABC' }, 'secret');
    const [body, sig] = token.split('.');
    const forgedBody = Buffer.from(
      JSON.stringify({ userId: 'GATTACKER', channel: 'email', exp: 9_999_999_999 }),
    ).toString('base64url');
    const forged = `${forgedBody}.${sig}`;
    expect(forged).not.toBe(token);
    expect(verifyUnsubscribeToken(forged, 'secret')).toBeNull();
    expect(verifyUnsubscribeToken(`${body}x.${sig}`, 'secret')).toBeNull();
  });

  it('rejects tokens signed with a different secret', () => {
    const token = signUnsubscribeToken({ userId: 'GABC' }, 'secret-a');
    expect(verifyUnsubscribeToken(token, 'secret-b')).toBeNull();
  });

  it('rejects expired tokens', () => {
    const issuedAt = 1_700_000_000;
    const token = signUnsubscribeToken({ userId: 'GABC' }, 'secret', issuedAt);
    const pastExpiry = issuedAt + 60 * 60 * 24 * 30 + 1;
    expect(verifyUnsubscribeToken(token, 'secret', pastExpiry)).toBeNull();
  });

  it('rejects garbage input', () => {
    expect(verifyUnsubscribeToken(undefined, 'secret')).toBeNull();
    expect(verifyUnsubscribeToken('', 'secret')).toBeNull();
    expect(verifyUnsubscribeToken('not-a-token', 'secret')).toBeNull();
    expect(verifyUnsubscribeToken('a.b.c', 'secret')).toBeNull();
  });
});

describe('RFC 8058 headers', () => {
  it('emits List-Unsubscribe and List-Unsubscribe-Post', () => {
    const url = 'https://app.example.com/api/v1/notifications/unsubscribe?token=abc';
    const headers = buildUnsubscribeHeaders(url);
    expect(headers).toEqual({
      'List-Unsubscribe': `<${url}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    expect(headers['List-Unsubscribe-Post']).toBe(ONE_CLICK_HEADER_VALUE);
  });

  it('builds the absolute unsubscribe URL', () => {
    expect(buildUnsubscribeUrl('tok', 'https://app.example.com/')).toBe(
      'https://app.example.com/api/v1/notifications/unsubscribe?token=tok',
    );
  });
});

describe('resolveUnsubscribeSecret', () => {
  it('prefers UNSUBSCRIBE_SECRET, then JWT_SECRET, then dev fallback', () => {
    const config = (values: Record<string, string>) => ({
      get: (key: string, defaultValue?: string) => values[key] ?? defaultValue,
    });
    expect(
      resolveUnsubscribeSecret(config({ UNSUBSCRIBE_SECRET: 'a', JWT_SECRET: 'b' })),
    ).toBe('a');
    expect(resolveUnsubscribeSecret(config({ JWT_SECRET: 'b' }))).toBe('b');
    expect(resolveUnsubscribeSecret(config({}))).toBe('niffyinsure-unsubscribe-dev');
  });
});
