import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { IpfsService } from './ipfs.service';
import { IdempotencyService } from './idempotency.service';
import { FileValidationService } from './file-validation.service';
import { IpfsProviderChainService } from './ipfs-provider-chain.service';

jest.mock('axios');

describe('IpfsService - Gateway Fallback', () => {
  let service: IpfsService;
  let mockConfig: Partial<ConfigService>;
  let mockIdempotency: Partial<IdempotencyService>;
  let mockFileValidation: Partial<FileValidationService>;
  let mockProviderChain: Partial<IpfsProviderChainService>;

  beforeEach(async () => {
    mockConfig = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        const values: Record<string, string> = {
          ALLOWED_IPFS_GATEWAYS: '',
        };
        return values[key] ?? defaultValue;
      }),
    };

    mockIdempotency = {};
    mockFileValidation = {
      getConfig: jest.fn().mockReturnValue({}),
    };
    mockProviderChain = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IpfsService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: IdempotencyService, useValue: mockIdempotency },
        { provide: FileValidationService, useValue: mockFileValidation },
        { provide: IpfsProviderChainService, useValue: mockProviderChain },
      ],
    }).compile();

    service = module.get(IpfsService);
  });

  describe('fetchFromGateway', () => {
    it('fetches content from the first healthy gateway', async () => {
      const axios = require('axios');
      const testBuffer = Buffer.from('test content');
      axios.get = jest.fn().mockResolvedValueOnce({ data: testBuffer });

      const result = await service.fetchFromGateway('QmTestCID');

      expect(result).toEqual(testBuffer);
      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('QmTestCID'),
        expect.objectContaining({
          responseType: 'arraybuffer',
          timeout: 30_000,
        }),
      );
    });

    it('falls back to next gateway on first gateway failure', async () => {
      const axios = require('axios');
      const testBuffer = Buffer.from('test content');

      // First gateway fails, second succeeds
      axios.get = jest
        .fn()
        .mockRejectedValueOnce(new Error('Gateway 1 timeout'))
        .mockResolvedValueOnce({ data: testBuffer });

      const result = await service.fetchFromGateway('QmTestCID');

      expect(result).toEqual(testBuffer);
      expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it('tries all gateways before failing', async () => {
      const axios = require('axios');
      axios.get = jest
        .fn()
        .mockRejectedValue(new Error('All gateways unavailable'));

      await expect(service.fetchFromGateway('QmTestCID')).rejects.toThrow(
        ServiceUnavailableException,
      );

      // Should attempt at least 2 gateways (default list has 4)
      expect(axios.get.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('uses custom gateways when configured', async () => {
      (mockConfig.get as jest.Mock).mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'ALLOWED_IPFS_GATEWAYS') {
          return 'https://custom1.example.com/ipfs/{{cid}},https://custom2.example.com/ipfs/{{cid}}';
        }
        return defaultValue;
      });

      // Recreate service with new config
      const module = await Test.createTestingModule({
        providers: [
          IpfsService,
          { provide: ConfigService, useValue: mockConfig },
          { provide: IdempotencyService, useValue: mockIdempotency },
          { provide: FileValidationService, useValue: mockFileValidation },
          { provide: IpfsProviderChainService, useValue: mockProviderChain },
        ],
      }).compile();

      service = module.get(IpfsService);

      const axios = require('axios');
      const testBuffer = Buffer.from('test content');
      axios.get = jest.fn().mockResolvedValueOnce({ data: testBuffer });

      await service.fetchFromGateway('QmTestCID');

      expect(axios.get).toHaveBeenCalledWith(
        'https://custom1.example.com/ipfs/QmTestCID',
        expect.any(Object),
      );
    });

    it('includes all error details in failure message', async () => {
      const axios = require('axios');
      axios.get = jest
        .fn()
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockRejectedValueOnce(new Error('Connection refused'));

      try {
        await service.fetchFromGateway('QmTestCID');
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceUnavailableException);
        const message = (error as any).message;
        expect(message).toContain('all gateways unavailable');
      }
    });
  });
});
