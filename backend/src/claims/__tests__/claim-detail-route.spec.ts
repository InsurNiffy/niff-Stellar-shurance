import { ConfigService } from '@nestjs/config';
import { ClaimStatus, VoteType } from '@prisma/client';
import { ClaimViewMapper } from '../claim-view.mapper';
import { SanitizationService } from '../sanitization.service';

const wallet = `G${'A'.repeat(55)}`;
const ipfsHash = `Qm${'a'.repeat(44)}`;

function makeClaim(overrides: Record<string, unknown> = {}) {
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  const updatedAt = new Date('2026-01-02T00:00:00.000Z');

  return {
    id: 424,
    policyId: 'policy-1',
    creatorAddress: wallet,
    amount: '10000000',
    asset: null,
    description: 'covered outage',
    imageUrls: [ipfsHash],
    status: ClaimStatus.APPROVED,
    isFinalized: false,
    approveVotes: 0,
    rejectVotes: 0,
    paidAt: null,
    createdAtLedger: 100,
    updatedAtLedger: 120,
    txHash: null,
    eventIndex: null,
    createdAt,
    updatedAt,
    tenantId: null,
    deletedAt: null,
    votes: [{ vote: VoteType.APPROVE }, { vote: VoteType.REJECT }],
    ...overrides,
  };
}

describe('claim detail response shape', () => {
  it('maps aggregation fields and status history onto the detail DTO', () => {
    const mapper = new ClaimViewMapper(
      new SanitizationService(),
      { get: jest.fn().mockReturnValue('https://ipfs.io') } as unknown as ConfigService,
    );

    const response = mapper.transformClaim(makeClaim(), 110, {
      quorum_progress_pct: 75,
      votes_needed: 2,
      deadline_estimate_utc: '2026-01-08T00:00:00.000Z',
    });

    expect(response.quorum_progress_pct).toBe(75);
    expect(response.votes_needed).toBe(2);
    expect(response.deadline_estimate_utc).toBe('2026-01-08T00:00:00.000Z');
    expect(response.status_history).toEqual([
      { status: 'pending', ledger: 100, timestamp: '2026-01-01T00:00:00.000Z' },
      { status: 'approved', ledger: 120, timestamp: '2026-01-02T00:00:00.000Z' },
    ]);
    expect(response.voter_eligible).toBe(false);
  });
});
