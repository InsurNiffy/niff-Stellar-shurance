import { SanitizationService } from './sanitization.service';

describe('SanitizationService — sanitizeEvidenceUrl', () => {
  let svc: SanitizationService;

  beforeEach(() => {
    // No ConfigService → uses DEFAULT_ALLOWED_GATEWAYS
    svc = new SanitizationService();
  });

  // ── Allowlisted URLs ──────────────────────────────────────────────────────

  it('accepts a valid ipfs.io URL', () => {
    const url = 'https://ipfs.io/ipfs/QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco';
    expect(svc.sanitizeEvidenceUrl(url)).toBe(url);
  });

  it('accepts a valid cloudflare-ipfs.com URL', () => {
    const url = 'https://cloudflare-ipfs.com/ipfs/QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco';
    expect(svc.sanitizeEvidenceUrl(url)).toBe(url);
  });

  it('accepts a valid gateway.pinata.cloud URL', () => {
    const url = 'https://gateway.pinata.cloud/ipfs/QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco';
    expect(svc.sanitizeEvidenceUrl(url)).toBe(url);
  });

  it('accepts a valid dweb.link URL', () => {
    const url = 'https://dweb.link/ipfs/QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco';
    expect(svc.sanitizeEvidenceUrl(url)).toBe(url);
  });

  it('accepts a valid nftstorage.link URL', () => {
    const url = 'https://nftstorage.link/ipfs/QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco';
    expect(svc.sanitizeEvidenceUrl(url)).toBe(url);
  });

  it('accepts a subdomain of dweb.link (CIDv1 subdomain)', () => {
    const url = 'https://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi.ipfs.dweb.link/';
    expect(svc.sanitizeEvidenceUrl(url)).toBe(url);
  });

  // ── Non-allowlisted URLs ──────────────────────────────────────────────────

  it('strips a non-allowlisted domain', () => {
    expect(svc.sanitizeEvidenceUrl('https://evil.com/ipfs/Qm123')).toBe('');
  });

  it('strips a URL with an allowlisted domain as a subdomain of a different host', () => {
    // ipfs.io.evil.com should NOT be allowed
    expect(svc.sanitizeEvidenceUrl('https://ipfs.io.evil.com/ipfs/Qm123')).toBe('');
  });

  // ── SSRF attempts ─────────────────────────────────────────────────────────

  it('blocks http:// scheme (SSRF / downgrade)', () => {
    expect(svc.sanitizeEvidenceUrl('http://ipfs.io/ipfs/Qm123')).toBe('');
  });

  it('blocks file:// scheme', () => {
    expect(svc.sanitizeEvidenceUrl('file:///etc/passwd')).toBe('');
  });

  it('blocks 127.0.0.1 (loopback)', () => {
    expect(svc.sanitizeEvidenceUrl('https://127.0.0.1/ipfs/Qm123')).toBe('');
  });

  it('blocks 10.x.x.x (RFC 1918)', () => {
    expect(svc.sanitizeEvidenceUrl('https://10.0.0.1/ipfs/Qm123')).toBe('');
  });

  it('blocks 172.16.x.x (RFC 1918)', () => {
    expect(svc.sanitizeEvidenceUrl('https://172.16.0.1/ipfs/Qm123')).toBe('');
  });

  it('blocks 192.168.x.x (RFC 1918)', () => {
    expect(svc.sanitizeEvidenceUrl('https://192.168.1.1/ipfs/Qm123')).toBe('');
  });

  it('blocks 169.254.x.x (link-local / AWS metadata)', () => {
    expect(svc.sanitizeEvidenceUrl('https://169.254.169.254/latest/meta-data/')).toBe('');
  });

  it('blocks localhost hostname', () => {
    expect(svc.sanitizeEvidenceUrl('https://localhost/ipfs/Qm123')).toBe('');
  });

  // ── Malformed URLs ────────────────────────────────────────────────────────

  it('returns empty string for a non-URL string', () => {
    expect(svc.sanitizeEvidenceUrl('not-a-url')).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(svc.sanitizeEvidenceUrl('')).toBe('');
  });

  it('returns empty string for null-like input', () => {
    expect(svc.sanitizeEvidenceUrl(null as unknown as string)).toBe('');
  });
});

describe('SanitizationService — config-driven allowlist', () => {
  it('uses ALLOWED_IPFS_GATEWAYS from ConfigService when provided', () => {
    const mockConfig = {
      get: (key: string) => (key === 'ALLOWED_IPFS_GATEWAYS' ? 'custom-gateway.example.com' : undefined),
    } as never;
    const svc = new SanitizationService(mockConfig);

    // Custom gateway should be allowed
    expect(svc.sanitizeEvidenceUrl('https://custom-gateway.example.com/ipfs/Qm123')).toBe(
      'https://custom-gateway.example.com/ipfs/Qm123',
    );
    // Default gateways should NOT be allowed when a custom list is set
    expect(svc.sanitizeEvidenceUrl('https://ipfs.io/ipfs/Qm123')).toBe('');
  });

  it('falls back to default gateways when ALLOWED_IPFS_GATEWAYS is empty', () => {
    const mockConfig = {
      get: (key: string) => (key === 'ALLOWED_IPFS_GATEWAYS' ? '' : undefined),
    } as never;
    const svc = new SanitizationService(mockConfig);
    expect(svc.sanitizeEvidenceUrl('https://ipfs.io/ipfs/Qm123')).toBe(
      'https://ipfs.io/ipfs/Qm123',
    );
  });
});

describe('SanitizationService — isPrivateHost', () => {
  let svc: SanitizationService;
  beforeEach(() => { svc = new SanitizationService(); });

  it.each([
    '127.0.0.1', '127.0.0.2', '10.0.0.1', '10.255.255.255',
    '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.255.255',
    '169.254.0.1', '169.254.169.254', 'localhost', '::1',
  ])('identifies %s as private', (host) => {
    expect(svc.isPrivateHost(host)).toBe(true);
  });

  it.each([
    'ipfs.io', 'cloudflare-ipfs.com', '8.8.8.8', '1.1.1.1',
  ])('identifies %s as public', (host) => {
    expect(svc.isPrivateHost(host)).toBe(false);
  });
});
