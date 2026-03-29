import { AdminPoliciesService } from './admin-policies.service';

describe('AdminPoliciesService', () => {
  const voteUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const claimUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const policyUpdate = jest.fn().mockResolvedValue({});
  const findMany = jest.fn().mockResolvedValue([]);
  const findUnique = jest.fn();

  const prisma = {
    policy: { findMany, findUnique, update: policyUpdate },
    claim: { updateMany: claimUpdateMany },
    vote: { updateMany: voteUpdateMany },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  let service: AdminPoliciesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminPoliciesService(prisma as never);
  });

  it('listPolicies excludes soft-deleted rows by default', async () => {
    await service.listPolicies(false);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } }),
    );
  });

  it('listPolicies with includeDeleted omits deletedAt filter', async () => {
    await service.listPolicies(true);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('softDeletePolicy sets deletedAt on votes, claims, and policy', async () => {
    findUnique.mockResolvedValue({
      id: 'GHOLDER:7',
      deletedAt: null,
    });
    const result = await service.softDeletePolicy('GHOLDER', 7);
    expect(result?.alreadyDeleted).toBe(false);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(voteUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null, claim: { policyId: 'GHOLDER:7' } },
      }),
    );
    expect(claimUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { policyId: 'GHOLDER:7', deletedAt: null },
      }),
    );
    expect(policyUpdate).toHaveBeenCalled();
  });

  it('softDeletePolicy is idempotent when already deleted', async () => {
    const past = new Date('2020-01-01');
    findUnique.mockResolvedValue({ id: 'G:1', deletedAt: past });
    const result = await service.softDeletePolicy('G', 1);
    expect(result?.alreadyDeleted).toBe(true);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
