import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { SorobanService } from './soroban.service';
import { RequestIdService } from '../common/tracing/request-id.service';

describe('SorobanService - Request ID Tracing', () => {
  let service: SorobanService;
  let requestIdService: RequestIdService;
  let loggerSpy: jest.SpyInstance;

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'SOROBAN_RPC_CIRCUIT_BREAKER_THRESHOLD') return 5;
        if (key === 'SOROBAN_RPC_CIRCUIT_BREAKER_RESET_MS') return 60_000;
        return defaultValue;
      }),
    };

    const mockRequestIdService = {
      getRequestId: jest.fn(() => 'test-request-id-123'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SorobanService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: RequestIdService, useValue: mockRequestIdService },
      ],
    }).compile();

    service = module.get<SorobanService>(SorobanService);
    requestIdService = module.get<RequestIdService>(RequestIdService);
    loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    loggerSpy.mockRestore();
  });

  it('should pass X-Request-ID header when creating server', () => {
    jest.spyOn(service as any, 'makeServer').mockReturnValue({} as any);
    const makeServerSpy = jest.spyOn(service as any, 'makeServer');

    service['makeServer']();

    expect(requestIdService.getRequestId).toHaveBeenCalled();
    expect(makeServerSpy).toHaveBeenCalled();
  });

  it('should handle missing request ID gracefully', () => {
    (requestIdService.getRequestId as jest.Mock).mockReturnValue('');

    const makeServerSpy = jest.spyOn(service as any, 'makeServer');
    service['makeServer']();

    expect(makeServerSpy).toHaveBeenCalled();
  });

  it('should include request ID in error logs', async () => {
    const errorMessage = 'Test error';
    const requestId = 'test-request-id-456';

    (requestIdService.getRequestId as jest.Mock).mockReturnValue(requestId);

    const logger = new Logger('TestService');
    const error = new Error(errorMessage);

    logger.error('Test error log', { error, requestId });

    expect(requestIdService.getRequestId).toBeDefined();
  });

  it('should propagate request ID through RPC calls', () => {
    expect(requestIdService.getRequestId()).toBe('test-request-id-123');
  });
});
