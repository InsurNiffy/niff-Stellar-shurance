import {
  claimTenantWhere,
  policyTenantWhere,
  voteTenantWhere,
  queryBypassesTenantFilter,
} from './tenant-filter.helper';

describe('tenant-filter soft delete', () => {
  it('claimTenantWhere defaults to active rows only', () => {
    expect(claimTenantWhere(null, { status: 'PENDING' })).toEqual({
      deletedAt: null,
      status: 'PENDING',
    });
  });

  it('claimTenantWhere includeDeleted skips deletedAt filter', () => {
    expect(claimTenantWhere(null, { status: 'PENDING' }, { includeDeleted: true })).toEqual({
      status: 'PENDING',
    });
  });

  it('policyTenantWhere defaults to active rows only', () => {
    expect(policyTenantWhere('t1', {})).toEqual({ tenantId: 't1', deletedAt: null });
  });
});

describe('voteTenantWhere', () => {
  it('returns extra only in single-tenant mode', () => {
    expect(voteTenantWhere(null, { vote: 'APPROVE' })).toEqual({
      vote: 'APPROVE',
    });
  });

  it('scopes votes through claim tenantId in multi-tenant mode', () => {
    expect(voteTenantWhere('acme', { vote: 'APPROVE' })).toEqual({
      claim: { tenantId: 'acme' },
      vote: 'APPROVE',
    });
  });
});

describe('queryBypassesTenantFilter', () => {
  it('flags a raw claim.findMany without tenant filter', () => {
    const code = `const claims = await prisma.claim.findMany({ where: { status: 'PENDING' } });`;
    const violations = queryBypassesTenantFilter(code);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain('claim.findMany');
  });

  it('does not flag a query using claimTenantWhere', () => {
    const code = `const claims = await prisma.claim.findMany({ where: claimTenantWhere(tenantId, { status: 'PENDING' }) });`;
    const violations = queryBypassesTenantFilter(code);
    expect(violations).toHaveLength(0);
  });

  it('does not flag a query using policyTenantWhere', () => {
    const code = `const policies = await prisma.policy.findMany({ where: policyTenantWhere(tenantId, { isActive: true }) });`;
    const violations = queryBypassesTenantFilter(code);
    expect(violations).toHaveLength(0);
  });

  it('flags policy.findFirst without tenant filter', () => {
    const code = `const policy = await prisma.policy.findFirst({ where: { id } });`;
    const violations = queryBypassesTenantFilter(code);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain('policy.findFirst');
  });

  it('ignores non-tenant-scoped models', () => {
    const code = `const logs = await prisma.adminAuditLog.findMany({ where: { action: 'reindex' } });`;
    const violations = queryBypassesTenantFilter(code);
    expect(violations).toHaveLength(0);
  });
});
