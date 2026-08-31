import axios from 'axios';
import { IpfsPinCheckJob } from './ipfs-pin-check.job';

jest.mock('axios', () => ({
  __esModule: true,
  default: { post: jest.fn().mockResolvedValue({ status: 200 }) },
}));

const axiosPost = axios.post as jest.Mock;

const makeDeps = (overrides: {
  config?: Record<string, string>;
  claims?: Array<{ id: number; imageUrls: string[] }>;
  existsResult?: { exists: boolean; providerName?: string };
  existsError?: Error;
}) => {
  const config: Record<string, string> = {
    IPFS_PIN_CHECK_ENABLED: 'true',
    IPFS_PIN_CHECK_ALERT_WEBHOOK_URL: '',
    IPFS_PIN_CHECK_ALERT_WEBHOOK_SECRET: '',
    ...overrides.config,
  };
  const prisma = {
    claim: {
      findMany: jest.fn().mockResolvedValue(
        overrides.claims ?? [{ id: 1, imageUrls: ['ipfs://QmTest1234567890123456789012345678901234567890ab'] }],
      ),
    },
  };
  const providerChain = {
    exists: overrides.existsError
      ? jest.fn().mockRejectedValue(overrides.existsError)
      : jest.fn().mockResolvedValue(overrides.existsResult ?? { exists: true, providerName: 'mock' }),
  };
  const configService = {
    get: jest.fn(<T>(key: string, def?: T): T => {
      return Object.prototype.hasOwnProperty.call(config, key)
        ? (config[key] as unknown as T)
        : (def as T);
    }),
  };
  return { configService, prisma, providerChain };
};

describe('IpfsPinCheckJob (issue #896)', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('extractCid', () => {
    let job: IpfsPinCheckJob;
    beforeEach(() => {
      const { configService, prisma, providerChain } = makeDeps({});
      job = new IpfsPinCheckJob(configService as never, prisma as never, providerChain as never);
    });

    it('extracts CID from ipfs:// URL', () => {
      expect(job.extractCid('ipfs://QmABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcde12')).toBe(
        'QmABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcde12',
      );
    });

    it('extracts CID from gateway URL', () => {
      expect(job.extractCid('https://gateway.pinata.cloud/ipfs/QmABC123')).toBe('QmABC123');
    });

    it('extracts bare Qm CID', () => {
      const cid = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
      expect(job.extractCid(cid)).toBe(cid);
    });

    it('returns null for non-IPFS URLs', () => {
      expect(job.extractCid('https://example.com/file.jpg')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(job.extractCid('')).toBeNull();
    });
  });

  describe('runPinCheck', () => {
    it('returns empty summary when disabled', async () => {
      const { configService, prisma, providerChain } = makeDeps({ config: { IPFS_PIN_CHECK_ENABLED: 'false' } });
      const job = new IpfsPinCheckJob(configService as never, prisma as never, providerChain as never);
      const summary = await job.runPinCheck();
      expect(summary.checked).toBe(0);
      expect(summary.unpinned).toHaveLength(0);
      expect(prisma.claim.findMany).not.toHaveBeenCalled();
    });

    it('reports pinned CIDs without alerting', async () => {
      const { configService, prisma, providerChain } = makeDeps({
        claims: [{ id: 1, imageUrls: ['ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'] }],
        existsResult: { exists: true, providerName: 'mock' },
      });
      const job = new IpfsPinCheckJob(configService as never, prisma as never, providerChain as never);
      const summary = await job.runPinCheck();
      expect(summary.checked).toBe(1);
      expect(summary.unpinned).toHaveLength(0);
      expect(axiosPost).not.toHaveBeenCalled();
    });

    it('flags unpinned CIDs and logs alert', async () => {
      const { configService, prisma, providerChain } = makeDeps({
        claims: [{ id: 42, imageUrls: ['ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'] }],
        existsResult: { exists: false },
      });
      const job = new IpfsPinCheckJob(configService as never, prisma as never, providerChain as never);
      const summary = await job.runPinCheck();
      expect(summary.unpinned).toHaveLength(1);
      expect(summary.unpinned[0].claimId).toBe(42);
      expect(axiosPost).not.toHaveBeenCalled(); // no webhook URL configured
    });

    it('fires webhook when CID is unpinned and webhook URL is set', async () => {
      const { configService, prisma, providerChain } = makeDeps({
        config: {
          IPFS_PIN_CHECK_ENABLED: 'true',
          IPFS_PIN_CHECK_ALERT_WEBHOOK_URL: 'https://ops.example.com/alert',
          IPFS_PIN_CHECK_ALERT_WEBHOOK_SECRET: 'secret',
        },
        claims: [{ id: 7, imageUrls: ['ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'] }],
        existsResult: { exists: false },
      });
      const job = new IpfsPinCheckJob(configService as never, prisma as never, providerChain as never);
      await job.runPinCheck();
      expect(axiosPost).toHaveBeenCalledWith(
        'https://ops.example.com/alert',
        expect.objectContaining({ event: 'ipfs_cid_unpinned', claimId: 7 }),
        expect.objectContaining({ headers: { 'X-Webhook-Secret': 'secret' } }),
      );
    });

    it('skips claims with no extractable CIDs', async () => {
      const { configService, prisma, providerChain } = makeDeps({
        claims: [{ id: 1, imageUrls: ['https://example.com/photo.jpg'] }],
      });
      const job = new IpfsPinCheckJob(configService as never, prisma as never, providerChain as never);
      const summary = await job.runPinCheck();
      expect(summary.checked).toBe(0);
      expect(providerChain.exists).not.toHaveBeenCalled();
    });

    it('counts errors when provider.exists throws unexpectedly', async () => {
      const { configService, prisma, providerChain } = makeDeps({
        claims: [{ id: 1, imageUrls: ['ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'] }],
        existsError: new Error('network error'),
      });
      const job = new IpfsPinCheckJob(configService as never, prisma as never, providerChain as never);
      const summary = await job.runPinCheck();
      expect(summary.errors).toBe(1);
      expect(summary.checked).toBe(0);
    });
  });
});
