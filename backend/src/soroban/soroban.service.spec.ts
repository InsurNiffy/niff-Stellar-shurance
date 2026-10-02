import { ConfigService } from '@nestjs/config';
import { SorobanService } from './soroban.service';
import { AppException } from '../common/errors/app.exception';

const mockServer = {
  getAccount: jest.fn(),
  simulateTransaction: jest.fn(),
  sendTransaction: jest.fn(),
  getTransaction: jest.fn(),
};

jest.mock('@stellar/stellar-sdk', () => {
  const real = jest.requireActual('@stellar/stellar-sdk') as object;
  return {
    ...real,
    rpc: {
      ...((real as { rpc: object }).rpc ?? {}),
      Server: jest.fn().mockImplementation(() => mockServer),
      assembleTransaction: jest.fn((tx: unknown) => tx),
      Api: {
        isSimulationError: jest.fn(),
      },
    },
  };
});

// opossum — pass through so tests run without a real breaker
jest.mock('opossum', () => {
  return jest.fn().mockImplementation((fn: (f: () => Promise<unknown>) => Promise<unknown>) => ({
    fire: (f: () => Promise<unknown>) => fn(f),
    on: jest.fn(),
  }));
});

function makeService() {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'SOROBAN_RPC_URL') return 'https://soroban-testnet.stellar.org';
      if (key === 'SOROBAN_SIMULATE_TIMEOUT_MS') return 30_000;
      if (key === 'CONTRACT_ID') return 'CABC';
      if (key === 'STELLAR_NETWORK_PASSPHRASE') return 'Test SDF Network ; September 2015';
      return undefined;
    }),
  } as unknown as ConfigService;
  const svc = new SorobanService(config);
  svc.onModuleInit();
  return svc;
}

describe('SorobanService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('simulate returns decoded value on success', async () => {
    const { rpc } = await import('@stellar/stellar-sdk');
    (rpc.Api.isSimulationError as jest.Mock).mockReturnValue(false);
    mockServer.getAccount.mockResolvedValue({
      id: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
      sequence: '0',
      incrementSequenceNumber: jest.fn(),
    });
    const mockScVal = { switch: () => ({ name: 'scvBool' }), value: () => true } as unknown;
    (mockServer.simulateTransaction as jest.Mock).mockResolvedValue({
      result: { retval: mockScVal },
    });

    const svc = makeService();
    const result = await svc.simulate('is_initialized', []);
    expect(result).toBeDefined();
  });

  it('simulate throws SIMULATION_FAILED on error result', async () => {
    const { rpc } = await import('@stellar/stellar-sdk');
    (rpc.Api.isSimulationError as jest.Mock).mockReturnValue(true);
    mockServer.getAccount.mockResolvedValue({
      id: 'G123',
      sequence: '0',
      incrementSequenceNumber: jest.fn(),
    });
    mockServer.simulateTransaction.mockResolvedValue({ error: 'some error' });

    const svc = makeService();
    await expect(svc.simulate('bad_method', [])).rejects.toThrow(AppException);
  });

  it('waitForResult throws TIMEOUT_ERROR when polling times out', async () => {
    mockServer.getTransaction.mockResolvedValue({ status: 'NOT_FOUND' });

    const svc = makeService();
    await expect(svc.waitForResult('fakehash', 100)).rejects.toThrow(AppException);
  });

  it('throws CONTRACT_NOT_CONFIGURED when CONTRACT_ID absent', async () => {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'SOROBAN_RPC_URL') return 'https://soroban-testnet.stellar.org';
        if (key === 'SOROBAN_SIMULATE_TIMEOUT_MS') return 30_000;
        return undefined;
      }),
    } as unknown as ConfigService;
    const svc = new SorobanService(config);
    svc.onModuleInit();
    mockServer.getAccount.mockResolvedValue({ id: 'G123', sequence: '0', incrementSequenceNumber: jest.fn() });
    await expect(svc.simulate('test', [])).rejects.toThrow(AppException);
  });
});
