import { claimTenantWhere, policyTenantWhere } from './tenant-filter.helper';

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
