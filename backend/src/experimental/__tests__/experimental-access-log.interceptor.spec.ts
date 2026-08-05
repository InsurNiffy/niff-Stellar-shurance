import { ExecutionContext, Logger } from '@nestjs/common';
import { of } from 'rxjs';
import { ExperimentalAccessLogInterceptor } from '../experimental-access-log.interceptor';

describe('ExperimentalAccessLogInterceptor', () => {
  let interceptor: ExperimentalAccessLogInterceptor;
  let loggerSpy: jest.SpyInstance;

  beforeEach(() => {
    interceptor = new ExperimentalAccessLogInterceptor();
    loggerSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    loggerSpy.mockRestore();
  });

  it('logs access to experimental endpoint', () => {
    const mockContext = {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({
          method: 'POST',
          url: '/experimental/oracle-hooks/ingest',
          ip: '192.168.1.1',
          get: jest.fn().mockReturnValue('Mozilla/5.0'),
        }),
      }),
    } as unknown as ExecutionContext;

    const mockNext = {
      handle: jest.fn().mockReturnValue(of({ accepted: true })),
    };

    interceptor.intercept(mockContext, mockNext);

    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('[experimental-endpoint]'),
      expect.objectContaining({
        caller_ip: '192.168.1.1',
        caller_user_agent: 'Mozilla/5.0',
        timestamp: expect.any(String),
      }),
    );
  });

  it('logs beta-calculator endpoint calls', () => {
    const mockContext = {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({
          method: 'POST',
          url: '/experimental/beta-calculators/premium-preview',
          ip: '10.0.0.1',
          get: jest.fn().mockReturnValue('curl/7.64.1'),
        }),
      }),
    } as unknown as ExecutionContext;

    const mockNext = {
      handle: jest.fn().mockReturnValue(of({ premium: 150.0 })),
    };

    interceptor.intercept(mockContext, mockNext);

    expect(loggerSpy).toHaveBeenCalled();
    const callArgs = loggerSpy.mock.calls[0];
    expect(callArgs[0]).toContain('beta-calculators/premium-preview');
  });

  it('includes timestamp in log entry', () => {
    const mockContext = {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({
          method: 'POST',
          url: '/experimental/oracle-hooks/ingest',
          ip: '127.0.0.1',
          get: jest.fn().mockReturnValue(''),
        }),
      }),
    } as unknown as ExecutionContext;

    const mockNext = {
      handle: jest.fn().mockReturnValue(of({ accepted: true })),
    };

    interceptor.intercept(mockContext, mockNext);

    const logCall = loggerSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(logCall.timestamp).toBeDefined();
    expect(typeof logCall.timestamp).toBe('string');
  });
});
