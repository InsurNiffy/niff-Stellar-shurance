import {
  assertSafeResolvedAddresses,
  assertSafeWebhookUrl,
  assertSafeWebhookUrlResolved,
  isBlockedIp,
  SsrfBlockedError,
} from './ssrf';

describe('SSRF URL validation (#1484)', () => {
  describe('assertSafeWebhookUrl', () => {
    it('accepts a public https URL', () => {
      const url = assertSafeWebhookUrl('https://partners.example.com/hooks/niffy');
      expect(url.hostname).toBe('partners.example.com');
    });

    it('rejects non-https schemes', () => {
      for (const url of [
        'http://example.com/hook',
        'ftp://example.com/hook',
        'file:///etc/passwd',
        'gopher://example.com/hook',
      ]) {
        expect(() => assertSafeWebhookUrl(url)).toThrow(SsrfBlockedError);
      }
    });

    it('rejects malformed URLs and empty input', () => {
      expect(() => assertSafeWebhookUrl('not a url')).toThrow(SsrfBlockedError);
      expect(() => assertSafeWebhookUrl('')).toThrow(SsrfBlockedError);
    });

    it('rejects embedded credentials', () => {
      expect(() => assertSafeWebhookUrl('https://user:pass@example.com/hook')).toThrow(
        SsrfBlockedError,
      );
    });

    it('blocks loopback IPv4 literals', () => {
      expect(() => assertSafeWebhookUrl('https://127.0.0.1/hook')).toThrow(SsrfBlockedError);
      expect(() => assertSafeWebhookUrl('https://127.0.0.53:8443/hook')).toThrow(
        SsrfBlockedError,
      );
    });

    it('blocks private IPv4 literals', () => {
      for (const host of ['10.0.0.8', '192.168.1.10', '172.16.4.4', '172.31.255.255']) {
        expect(() => assertSafeWebhookUrl(`https://${host}/hook`)).toThrow(SsrfBlockedError);
      }
    });

    it('blocks link-local IPv4 literals', () => {
      expect(() => assertSafeWebhookUrl('https://169.254.169.254/latest/meta-data')).toThrow(
        SsrfBlockedError,
      );
    });

    it('blocks CGNAT and unspecified addresses', () => {
      expect(() => assertSafeWebhookUrl('https://100.64.0.1/hook')).toThrow(SsrfBlockedError);
      expect(() => assertSafeWebhookUrl('https://0.0.0.0/hook')).toThrow(SsrfBlockedError);
    });

    it('blocks loopback and private IPv6 literals', () => {
      expect(() => assertSafeWebhookUrl('https://[::1]/hook')).toThrow(SsrfBlockedError);
      expect(() => assertSafeWebhookUrl('https://[fc00::1]/hook')).toThrow(SsrfBlockedError);
      expect(() => assertSafeWebhookUrl('https://[fe80::1]/hook')).toThrow(SsrfBlockedError);
      expect(() => assertSafeWebhookUrl('https://[::ffff:127.0.0.1]/hook')).toThrow(
        SsrfBlockedError,
      );
    });

    it('blocks localhost and .local hostnames', () => {
      expect(() => assertSafeWebhookUrl('https://localhost/hook')).toThrow(SsrfBlockedError);
      expect(() => assertSafeWebhookUrl('https://api.localhost/hook')).toThrow(SsrfBlockedError);
      expect(() => assertSafeWebhookUrl('https://nas.local/hook')).toThrow(SsrfBlockedError);
    });
  });

  describe('isBlockedIp', () => {
    it('classifies public addresses as safe', () => {
      expect(isBlockedIp('93.184.216.34')).toBe(false);
      expect(isBlockedIp('8.8.8.8')).toBe(false);
      expect(isBlockedIp('2606:4700:4700::1111')).toBe(false);
    });

    it('classifies private / loopback / link-local as blocked', () => {
      expect(isBlockedIp('127.0.0.1')).toBe(true);
      expect(isBlockedIp('10.1.2.3')).toBe(true);
      expect(isBlockedIp('192.168.0.1')).toBe(true);
      expect(isBlockedIp('169.254.0.1')).toBe(true);
      expect(isBlockedIp('::1')).toBe(true);
      expect(isBlockedIp('fe80::1')).toBe(true);
      expect(isBlockedIp('fd00::1')).toBe(true);
    });
  });

  describe('assertSafeResolvedAddresses (post-DNS)', () => {
    it('accepts publicly routable resolutions', () => {
      expect(() =>
        assertSafeResolvedAddresses('hooks.example.com', ['93.184.216.34']),
      ).not.toThrow();
    });

    it('blocks a public hostname that rebinds to loopback', () => {
      expect(() =>
        assertSafeResolvedAddresses('evil.example.com', ['93.184.216.34', '127.0.0.1']),
      ).toThrow(SsrfBlockedError);
    });

    it('blocks resolutions to private, link-local and IPv6 loopback', () => {
      expect(() => assertSafeResolvedAddresses('h', ['10.0.0.5'])).toThrow(SsrfBlockedError);
      expect(() => assertSafeResolvedAddresses('h', ['169.254.169.254'])).toThrow(
        SsrfBlockedError,
      );
      expect(() => assertSafeResolvedAddresses('h', ['::1'])).toThrow(SsrfBlockedError);
      expect(() => assertSafeResolvedAddresses('h', [])).toThrow(SsrfBlockedError);
    });
  });

  describe('assertSafeWebhookUrlResolved', () => {
    it('validates DNS results with an injected lookup', async () => {
      const good = jest.fn().mockResolvedValue(['93.184.216.34']);
      await expect(
        assertSafeWebhookUrlResolved('https://hooks.example.com/x', good),
      ).resolves.toBeInstanceOf(URL);
      expect(good).toHaveBeenCalledWith('hooks.example.com');
    });

    it('rejects hostnames resolving to private addresses', async () => {
      const evil = jest.fn().mockResolvedValue(['192.168.1.1']);
      await expect(
        assertSafeWebhookUrlResolved('https://internal.example.com/x', evil),
      ).rejects.toThrow(SsrfBlockedError);
    });

    it('rejects when DNS resolution fails', async () => {
      const fail = jest.fn().mockRejectedValue(new Error('ENOTFOUND'));
      await expect(
        assertSafeWebhookUrlResolved('https://nope.example.com/x', fail),
      ).rejects.toThrow(SsrfBlockedError);
    });

    it('checks every hostname through the injected DNS lookup', async () => {
      const lookup = jest.fn().mockResolvedValue(['93.184.216.34']);
      await expect(
        assertSafeWebhookUrlResolved('https://hooks.example.com/x', lookup),
      ).resolves.toBeInstanceOf(URL);
      expect(lookup).toHaveBeenCalled();
    });
  });
});
