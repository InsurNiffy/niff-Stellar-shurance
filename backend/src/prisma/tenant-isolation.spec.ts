import { assertTenantScoped } from './tenant-isolation';

describe('assertTenantScoped (issue #1632)', () => {
  it('rejects tenant-scoped queries without tenantId', () => {
    expect(() => assertTenantScoped('Policy', 'findMany', { where: {} })).toThrow(/tenantId/);
    expect(() => assertTenantScoped('Claim', 'findFirst', undefined)).toThrow(/tenantId/);
  });

  it('allows queries scoped to a tenant', () => {
    expect(() => assertTenantScoped('Policy', 'findMany', { where: { tenantId: 't1' } })).not.toThrow();
  });

  it('ignores non-tenant models and unguarded operations', () => {
    expect(() => assertTenantScoped('Notification', 'findMany', { where: {} })).not.toThrow();
    expect(() => assertTenantScoped('Policy', 'create', {})).not.toThrow();
  });
});
