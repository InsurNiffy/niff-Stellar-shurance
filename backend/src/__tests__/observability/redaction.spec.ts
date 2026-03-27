import { redactHeaders, redactBody } from '../../common/logger/app-logger.service';

describe('redactHeaders', () => {
  it('redacts Authorization header', () => {
    const result = redactHeaders({ authorization: 'Bearer secret-token' });
    expect(result['authorization']).toBe('[REDACTED]');
  });

  it('redacts cookie header (case-insensitive key)', () => {
    const result = redactHeaders({ Cookie: 'session=abc123' });
    // Our implementation lowercases keys during lookup
    expect(result['Cookie']).toBe('[REDACTED]');
  });

  it('redacts x-api-key', () => {
    const result = redactHeaders({ 'x-api-key': 'my-key' });
    expect(result['x-api-key']).toBe('[REDACTED]');
  });

  it('preserves non-sensitive headers', () => {
    const result = redactHeaders({
      'content-type': 'application/json',
      'x-request-id': 'abc-123',
    });
    expect(result['content-type']).toBe('application/json');
    expect(result['x-request-id']).toBe('abc-123');
  });

  it('never leaks Authorization in the output object', () => {
    const headers = {
      authorization: 'Bearer super-secret',
      'content-type': 'application/json',
    };
    const result = redactHeaders(headers);
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain('super-secret');
  });
});

describe('redactBody', () => {
  it('redacts password field', () => {
    const result = redactBody({ password: 'hunter2', username: 'alice' });
    expect(result!['password']).toBe('[REDACTED]');
    expect(result!['username']).toBe('alice');
  });

  it('redacts privateKey field', () => {
    const result = redactBody({ privateKey: 'SXXX...', amount: 100 });
    expect(result!['privateKey']).toBe('[REDACTED]');
  });

  it('returns undefined for undefined input', () => {
    expect(redactBody(undefined)).toBeUndefined();
  });
});
