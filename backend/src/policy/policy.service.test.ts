/**
 * Policy transaction builder tests.
 *
 * These tests mock the Soroban client module so no network calls are made.
 * They verify DTO → service argument mapping and correct error propagation.
 */

import { AppError } from '../middleware/errorHandler';
import { buildPolicyTransaction } from './policy.service';
import * as sorobanClient from '../soroban/soroban.client';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../soroban/soroban.client', () => ({
  ...jest.requireActual('../soroban/soroban.client'),
  buildInitiatePolicyTransaction: jest.fn(),
}));

const mockBuild = sorobanClient.buildInitiatePolicyTransaction as jest.MockedFunction<
  typeof sorobanClient.buildInitiatePolicyTransaction
>;

const VALID_HOLDER = 'GDVOEGATQV4FGUJKDEBEYT5NAPWJ55MEMJVLC5TU7Y74WD73PPAS4TYW';

const SUCCESS_RESULT: sorobanClient.BuildTransactionResult = {
  unsignedXdr: 'AAAA==',
  minResourceFee: '500000',
  baseFee: '100',
  totalEstimatedFee: '500100',
  totalEstimatedFeeXlm: '0.0500100',
  authRequirements: [{ address: VALID_HOLDER, isContract: false }],
  memoConvention: 'NiffyInsure does not use memos for protocol correlation.',
  currentLedger: 100000,
};

const VALID_DTO = {
  holder: VALID_HOLDER,
  policy_type: 'Auto' as const,
  region: 'Low' as const,
  coverage: '1000000000',
  age: 30,
  risk_score: 5,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildPolicyTransaction', () => {
  beforeEach(() => {
    mockBuild.mockReset();
  });

  it('returns assembled transaction result on success', async () => {
    mockBuild.mockResolvedValue(SUCCESS_RESULT);

    const result = await buildPolicyTransaction(VALID_DTO);

    expect(result.unsignedXdr).toBe('AAAA==');
    expect(result.authRequirements).toHaveLength(1);
    expect(result.authRequirements[0].address).toBe(VALID_HOLDER);
    expect(result.memoConvention).toBeTruthy();
  });

  it('passes coverage as BigInt to the Soroban client', async () => {
    mockBuild.mockResolvedValue(SUCCESS_RESULT);

    await buildPolicyTransaction(VALID_DTO);

    expect(mockBuild).toHaveBeenCalledWith(
      expect.objectContaining({ coverage: BigInt('1000000000') }),
    );
  });

  it('propagates ACCOUNT_NOT_FOUND error distinctly', async () => {
    mockBuild.mockRejectedValue(
      new AppError(
        400,
        'ACCOUNT_NOT_FOUND',
        'Account does not exist on this network.',
      ),
    );

    await expect(buildPolicyTransaction(VALID_DTO)).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_FOUND',
      statusCode: 400,
    });
  });

  it('propagates WRONG_NETWORK error distinctly', async () => {
    mockBuild.mockRejectedValue(
      new AppError(400, 'WRONG_NETWORK', 'Configured RPC is on a different network.'),
    );

    await expect(buildPolicyTransaction(VALID_DTO)).rejects.toMatchObject({
      code: 'WRONG_NETWORK',
      statusCode: 400,
    });
  });

  it('propagates CONTRACT_NOT_DEPLOYED error', async () => {
    mockBuild.mockRejectedValue(
      new AppError(503, 'CONTRACT_NOT_DEPLOYED', 'Contract not deployed.'),
    );

    await expect(buildPolicyTransaction(VALID_DTO)).rejects.toMatchObject({
      code: 'CONTRACT_NOT_DEPLOYED',
      statusCode: 503,
    });
  });

  it('passes optional start_ledger and duration_ledgers to the client', async () => {
    mockBuild.mockResolvedValue(SUCCESS_RESULT);

    await buildPolicyTransaction({
      ...VALID_DTO,
      start_ledger: 200000,
      duration_ledgers: 500000,
    });

    expect(mockBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        startLedger: 200000,
        durationLedgers: 500000,
      }),
    );
  });
});
