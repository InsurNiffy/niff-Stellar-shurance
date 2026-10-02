import { redactHeaders, redactBody, redactValue, redactMessageText } from '../common/logger/app-logger.service';

describe('Logging — sensitive-field redaction', () => {
  describe('redactHeaders', () => {
    it('masks authorization header', () => {
      const result = redactHeaders({ authorization: 'Bearer jwt.token.here' });
      expect(result['authorization']).toBe('[REDACTED]');
    });

    it('masks x-api-key', () => {
      expect(redactHeaders({ 'x-api-key': 'key' })['x-api-key']).toBe('[REDACTED]');
    });

    it('preserves x-request-id', () => {
      const id = 'abc-123';
      expect(redactHeaders({ 'x-request-id': id })['x-request-id']).toBe(id);
    });

    it('does not leak auth value in JSON serialisation', () => {
      const result = redactHeaders({ authorization: 'Bearer super-secret' });
      expect(JSON.stringify(result)).not.toContain('super-secret');
    });
  });

  describe('redactBody', () => {
    it('masks password', () => {
      const result = redactBody({ password: 'hunter2', username: 'alice' });
      expect(result!['password']).toBe('[REDACTED]');
      expect(result!['username']).toBe('alice');
    });

    it('masks signature', () => {
      const result = redactBody({ signature: 'ed25519sig', amount: 100 });
      expect(result!['signature']).toBe('[REDACTED]');
    });

    it('returns undefined for undefined input', () => {
      expect(redactBody(undefined)).toBeUndefined();
    });
  });

  describe('redactValue — nested objects', () => {
    it('redacts secret-like keys recursively', () => {
      const input = { jwtSecret: 'super-secret', nested: { apiKey: 'key' } };
      const result = redactValue(input);
      expect((result as typeof input).jwtSecret).toBe('[REDACTED]');
      expect((result as typeof input).nested.apiKey).toBe('[REDACTED]');
    });
  });

  describe('redactMessageText — inline text', () => {
    it('masks secret assignments and Bearer tokens', () => {
      const msg = 'JWT_SECRET=my-value Authorization: Bearer abc.def.ghi';
      const result = redactMessageText(msg);
      expect(result).not.toContain('my-value');
      expect(result).not.toContain('abc.def.ghi');
    });
  });
});
