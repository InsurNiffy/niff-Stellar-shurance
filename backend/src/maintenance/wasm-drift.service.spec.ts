import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { WasmDriftService } from './wasm-drift.service';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';

describe('WasmDriftService', () => {
  let service: WasmDriftService;
  let mockConfig: jest.Mocked<ConfigService>;
  let mockPrisma: jest.Mocked<PrismaService>;
  let mockServer: jest.Mocked<SorobanRpc.Server>;

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn(),
    };
    const mockPrismaService = {
      wasmDriftAlert: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WasmDriftService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<WasmDriftService>(WasmDriftService);
    mockConfig = module.get(ConfigService);
    mockPrisma = module.get(PrismaService);

    // Mock SorobanRpc.Server
    mockServer = {
      getLedgerEntries: jest.fn(),
    } as any;
    jest.spyOn(SorobanRpc, 'Server').mockImplementation(() => mockServer);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('checkDrift', () => {
    it('should skip contracts with missing config', async () => {
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'SOROBAN_RPC_URL') return 'https://soroban-testnet.stellar.org';
        if (key === 'DEPLOYMENT_REGISTRY_PATH') return 'contracts/deployment-registry.json';
        return undefined;
      });

      // Mock fs and path
      jest.spyOn(require('fs'), 'readFileSync').mockReturnValue(JSON.stringify({
        contracts: [{ name: 'test', contractId: '${MISSING_VAR}', expectedWasmHash: 'hash' }]
      }));
      jest.spyOn(require('path'), 'resolve').mockReturnValue('/path/to/registry.json');

      const loggerSpy = jest.spyOn(service['logger'], 'warn').mockImplementation();

      await service.checkDrift();

      expect(loggerSpy).toHaveBeenCalledWith('Skipping test: CONTRACT_ID or expected hash not configured');
    });

    it('should detect and handle drift', async () => {
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'SOROBAN_RPC_URL') return 'https://soroban-testnet.stellar.org';
        if (key === 'DEPLOYMENT_REGISTRY_PATH') return 'contracts/deployment-registry.json';
        return undefined;
      });

      jest.spyOn(require('fs'), 'readFileSync').mockReturnValue(JSON.stringify({
        contracts: [{ name: 'test', contractId: 'test-id', expectedWasmHash: 'expected-hash' }]
      }));
      jest.spyOn(require('path'), 'resolve').mockReturnValue('/path/to/registry.json');

      // Mock fetchOnChainWasmHash to return different hash
      jest.spyOn(service as any, 'fetchOnChainWasmHash').mockResolvedValue('actual-hash');

      // Mock no existing alert
      mockPrisma.wasmDriftAlert.findUnique.mockResolvedValue(null);

      // Mock create alert
      mockPrisma.wasmDriftAlert.create.mockResolvedValue({} as any);

      // Mock sendWebhookAlert
      jest.spyOn(service as any, 'sendWebhookAlert').mockResolvedValue();

      const loggerSpy = jest.spyOn(service['logger'], 'error').mockImplementation();

      await service.checkDrift();

      expect(mockPrisma.wasmDriftAlert.create).toHaveBeenCalledWith({
        data: {
          dedupKey: 'test:actual-hash',
          contractName: 'test',
          contractId: 'test-id',
          expectedHash: 'expected-hash',
          actualHash: 'actual-hash'
        }
      });
      expect(loggerSpy).toHaveBeenCalledWith(
        '[wasm-drift] DRIFT DETECTED on test | expected=expected-hash | actual=actual-hash'
      );
    });

    it('should skip already alerted drift', async () => {
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'SOROBAN_RPC_URL') return 'https://soroban-testnet.stellar.org';
        if (key === 'DEPLOYMENT_REGISTRY_PATH') return 'contracts/deployment-registry.json';
        return undefined;
      });

      jest.spyOn(require('fs'), 'readFileSync').mockReturnValue(JSON.stringify({
        contracts: [{ name: 'test', contractId: 'test-id', expectedWasmHash: 'expected-hash' }]
      }));
      jest.spyOn(require('path'), 'resolve').mockReturnValue('/path/to/registry.json');

      jest.spyOn(service as any, 'fetchOnChainWasmHash').mockResolvedValue('actual-hash');

      // Mock existing alert
      mockPrisma.wasmDriftAlert.findUnique.mockResolvedValue({} as any);

      const loggerSpy = jest.spyOn(service['logger'], 'warn').mockImplementation();

      await service.checkDrift();

      expect(mockPrisma.wasmDriftAlert.create).not.toHaveBeenCalled();
      expect(loggerSpy).toHaveBeenCalledWith('[wasm-drift] DRIFT on test already alerted (dedup key: test:actual-hash)');
    });

    it('should log OK for matching hashes', async () => {
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'SOROBAN_RPC_URL') return 'https://soroban-testnet.stellar.org';
        if (key === 'DEPLOYMENT_REGISTRY_PATH') return 'contracts/deployment-registry.json';
        return undefined;
      });

      jest.spyOn(require('fs'), 'readFileSync').mockReturnValue(JSON.stringify({
        contracts: [{ name: 'test', contractId: 'test-id', expectedWasmHash: 'matching-hash' }]
      }));
      jest.spyOn(require('path'), 'resolve').mockReturnValue('/path/to/registry.json');

      jest.spyOn(service as any, 'fetchOnChainWasmHash').mockResolvedValue('matching-hash');

      const loggerSpy = jest.spyOn(service['logger'], 'log').mockImplementation();

      await service.checkDrift();

      expect(loggerSpy).toHaveBeenCalledWith('[wasm-drift] test: OK (matching-ha…)');
    });

    it('should handle fetch errors gracefully', async () => {
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'SOROBAN_RPC_URL') return 'https://soroban-testnet.stellar.org';
        if (key === 'DEPLOYMENT_REGISTRY_PATH') return 'contracts/deployment-registry.json';
        return undefined;
      });

      jest.spyOn(require('fs'), 'readFileSync').mockReturnValue(JSON.stringify({
        contracts: [{ name: 'test', contractId: 'test-id', expectedWasmHash: 'hash' }]
      }));
      jest.spyOn(require('path'), 'resolve').mockReturnValue('/path/to/registry.json');

      jest.spyOn(service as any, 'fetchOnChainWasmHash').mockRejectedValue(new Error('RPC error'));

      const loggerSpy = jest.spyOn(service['logger'], 'error').mockImplementation();

      await service.checkDrift();

      expect(loggerSpy).toHaveBeenCalledWith('[wasm-drift] Failed to check test: RPC error');
    });
  });

  describe('fetchOnChainWasmHash', () => {
    it('should use getContractWasmByContractId if available', async () => {
      const mockServerWithMethod = {
        ...mockServer,
        getContractWasmByContractId: jest.fn().mockResolvedValue({ wasmHash: 'hash-from-method' }),
      };

      const result = await (service as any).fetchOnChainWasmHash(mockServerWithMethod, 'contract-id');

      expect(mockServerWithMethod.getContractWasmByContractId).toHaveBeenCalledWith('contract-id');
      expect(result).toBe('hash-from-method');
    });

    it('should fall back to manual ledger entry parsing', async () => {
      const mockEntry = {
        val: () => ({
          contractData: () => ({
            val: () => ({
              instance: () => ({
                executable: () => ({
                  wasmHash: () => Buffer.from('manual-hash', 'utf-8'),
                }),
              }),
            }),
          }),
        }),
      };

      mockServer.getLedgerEntries.mockResolvedValue({ entries: [mockEntry] });

      const result = await (service as any).fetchOnChainWasmHash(mockServer, 'contract-id');

      expect(mockServer.getLedgerEntries).toHaveBeenCalled();
      expect(result).toBe('6d616e75616c2d68617368'); // hex of 'manual-hash'
    });

    it('should throw if no ledger entry found', async () => {
      mockServer.getLedgerEntries.mockResolvedValue({ entries: [] });

      await expect((service as any).fetchOnChainWasmHash(mockServer, 'contract-id')).rejects.toThrow(
        'No ledger entry for contract contract-id'
      );
    });
  });

  describe('handleDrift', () => {
    it('should create alert and send webhook', async () => {
      mockPrisma.wasmDriftAlert.findUnique.mockResolvedValue(null);
      mockPrisma.wasmDriftAlert.create.mockResolvedValue({} as any);

      jest.spyOn(service as any, 'sendWebhookAlert').mockResolvedValue();

      await (service as any).handleDrift('test', 'id', 'exp', 'act');

      expect(mockPrisma.wasmDriftAlert.create).toHaveBeenCalledWith({
        data: {
          dedupKey: 'test:act',
          contractName: 'test',
          contractId: 'id',
          expectedHash: 'exp',
          actualHash: 'act',
        },
      });
      expect((service as any).sendWebhookAlert).toHaveBeenCalledWith({
        name: 'test',
        contractId: 'id',
        expected: 'exp',
        actual: 'act',
      });
    });
  });

  describe('sendWebhookAlert', () => {
    it('should send webhook if URL configured', async () => {
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'WASM_DRIFT_WEBHOOK_URL') return 'https://webhook.example.com';
        if (key === 'WASM_DRIFT_WEBHOOK_SECRET') return 'secret';
        return undefined;
      });

      const axiosPost = jest.fn().mockResolvedValue({});
      jest.doMock('axios', () => ({ default: { post: axiosPost } }));

      const loggerSpy = jest.spyOn(service['logger'], 'log').mockImplementation();

      await (service as any).sendWebhookAlert({
        name: 'test',
        contractId: 'id',
        expected: 'exp',
        actual: 'act',
      });

      expect(axiosPost).toHaveBeenCalledWith(
        'https://webhook.example.com',
        expect.objectContaining({
          event: 'wasm_drift_detected',
          severity: 'critical',
          contract: 'test',
          contractId: 'id',
          expectedHash: 'exp',
          actualHash: 'act',
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Webhook-Secret': 'secret',
          }),
          timeout: 5000,
        })
      );
      expect(loggerSpy).toHaveBeenCalledWith('[wasm-drift] Alert webhook delivered for test');
    });

    it('should skip webhook if URL not configured', async () => {
      mockConfig.get.mockReturnValue(undefined);

      const loggerSpy = jest.spyOn(service['logger'], 'warn').mockImplementation();

      await (service as any).sendWebhookAlert({
        name: 'test',
        contractId: 'id',
        expected: 'exp',
        actual: 'act',
      });

      expect(loggerSpy).toHaveBeenCalledWith('[wasm-drift] WASM_DRIFT_WEBHOOK_URL not set — alert logged only');
    });

    it('should handle webhook delivery failure', async () => {
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'WASM_DRIFT_WEBHOOK_URL') return 'https://webhook.example.com';
        return undefined;
      });

      const axiosPost = jest.fn().mockRejectedValue(new Error('Network error'));
      jest.doMock('axios', () => ({ default: { post: axiosPost } }));

      const loggerSpy = jest.spyOn(service['logger'], 'error').mockImplementation();

      await (service as any).sendWebhookAlert({
        name: 'test',
        contractId: 'id',
        expected: 'exp',
        actual: 'act',
      });

      expect(loggerSpy).toHaveBeenCalledWith('[wasm-drift] Webhook delivery failed: Network error');
    });
  });

  describe('loadRegistry', () => {
    it('should load and parse registry file', () => {
      mockConfig.get.mockReturnValue('custom/path.json');

      jest.spyOn(require('path'), 'resolve').mockReturnValue('/resolved/path.json');
      jest.spyOn(require('fs'), 'readFileSync').mockReturnValue('{"contracts": [{"name": "test"}]}');

      const result = (service as any).loadRegistry();

      expect(result).toEqual({ contracts: [{ name: 'test' }] });
    });
  });

  describe('resolveEnv', () => {
    it('should resolve environment variables', () => {
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'TEST_VAR') return 'resolved-value';
        return '';
      });

      const result = (service as any).resolveEnv('${TEST_VAR} and ${MISSING_VAR}');

      expect(result).toBe('resolved-value and ');
    });

    it('should return unchanged if no placeholders', () => {
      const result = (service as any).resolveEnv('no-vars-here');

      expect(result).toBe('no-vars-here');
    });
  });
});