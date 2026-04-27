# Admin Role Assignment Process

This document outlines the process for assigning and managing admin roles in the NiffyInsure backend system.

## Overview

Admin roles provide staff-level privileges for accessing administrative endpoints and performing system operations. Role assignment is controlled through the authentication system and requires proper authorization.

## Role Types

### 1. Admin Role
- **Purpose**: Full administrative access to all system endpoints
- **Privileges**: Access to `/admin/*` endpoints, audit logs, system configuration
- **Requirements**: Staff employment status and explicit admin authorization

### 2. Staff Role
- **Purpose**: Basic staff access for non-admin operations
- **Privileges**: Limited access to staff-specific endpoints
- **Requirements**: Staff employment status

### 3. User Role
- **Purpose**: Regular user access
- **Privileges**: Standard user endpoints only
- **Requirements**: Valid wallet authentication

## Assignment Process

### Prerequisites
- Employee must have completed onboarding
- Background check completed (if applicable)
- Required training completed
- Manager approval obtained

### Step-by-Step Assignment

1. **Initiation**
   ```bash
   # Manager or authorized admin initiates role assignment
   # Contact the DevOps team with the following information:
   - Employee wallet address
   - Required role level (admin/staff)
   - Business justification
   - Duration (temporary or permanent)
   - Manager approval reference
   ```

2. **Verification**
   ```bash
   # DevOps team verifies:
   - Employee status in HR system
   - Manager approval
   - Training completion
   - Background check status
   ```

3. **Database Assignment**
   ```sql
   -- Direct database assignment (emergency only)
   UPDATE auth_identities 
   SET role = 'admin', 
       updated_at = NOW()
   WHERE wallet_address = 'GADMIN...';
   
   -- Or through admin interface
   POST /admin/staff/roles
   {
     "walletAddress": "GADMIN...",
     "role": "admin",
     "reason": "System administration duties",
     "approvedBy": "GMANAGER..."
   }
   ```

4. **Audit Trail**
   ```json
   {
     "actor": "GDEVOPS...",
     "action": "admin_role_assigned",
     "payload": {
       "targetWallet": "GADMIN...",
       "role": "admin",
       "reason": "System administration duties",
       "approvedBy": "GMANAGER..."
     },
     "ipAddress": "192.168.1.100",
     "createdAt": "2024-01-15T10:30:00Z"
   }
   ```

## Role Verification

### Automated Verification
All admin endpoints automatically verify roles through the `AdminRoleGuard`:

```typescript
// Guard checks in order:
1. Authentication exists
2. Identity kind is 'staff'
3. Role is 'admin'
4. Logs access attempt
5. Grants or denies access
```

### Manual Verification
```bash
# Check current role assignment
curl -H "Authorization: Bearer <token>" \
     https://api.niffyinsure.com/admin/role-status

# Expected response for admin:
{
  "walletAddress": "GADMIN...",
  "role": "admin",
  "kind": "staff",
  "permissions": ["admin", "staff", "user"]
}
```

## Temporary Role Assignment

### Emergency Access
```bash
# Temporary admin access (24 hours)
POST /admin/staff/temporary-roles
{
  "walletAddress": "GSTAFF...",
  "role": "admin",
  "duration": "24h",
  "reason": "Emergency maintenance",
  "approvedBy": "GMANAGER..."
}
```

### Scheduled Access
```bash
# Scheduled admin access
POST /admin/staff/scheduled-roles
{
  "walletAddress": "GSTAFF...",
  "role": "admin",
  "startTime": "2024-01-20T09:00:00Z",
  "endTime": "2024-01-20T17:00:00Z",
  "reason": "Planned maintenance window",
  "approvedBy": "GMANAGER..."
}
```

## Role Removal Process

### Standard Removal
1. **Manager Request**: Manager requests role removal
2. **Verification**: DevOps verifies employment status
3. **Removal**: Role is removed from database
4. **Audit**: Removal is logged in audit trail

### Immediate Removal (Emergency)
```bash
# Immediate role revocation
POST /admin/staff/revoke-role
{
  "walletAddress": "GADMIN...",
  "reason": "Security incident",
  "immediate": true,
  "approvedBy": "GSECURITY..."
}
```

## Audit and Compliance

### Required Documentation
- Role assignment requests
- Manager approvals
- Training completion records
- Access reviews

### Regular Reviews
- **Monthly**: Review all admin role assignments
- **Quarterly**: Full access audit
- **Annually**: Compliance review with security team

### Audit Queries
```sql
-- List all current admins
SELECT wallet_address, role, created_at, updated_at
FROM auth_identities 
WHERE role = 'admin' AND kind = 'staff'
ORDER BY updated_at DESC;

-- Role assignment history
SELECT * FROM admin_audit_logs 
WHERE action LIKE '%role%'
ORDER BY created_at DESC;
```

## Security Considerations

### Principle of Least Privilege
- Assign minimum necessary role level
- Use temporary roles for specific tasks
- Regular role reviews and cleanup

### Separation of Duties
- Different admins for different functions
- No single admin has all privileges
- Critical actions require multiple approvals

### Monitoring and Alerting
```typescript
// Alert on suspicious admin activity
- New admin role assignment
- Role changes outside business hours
- Multiple failed admin login attempts
- Admin access from unusual locations
```

## Integration Tests

### Role Guard Testing
```typescript
// Test admin role enforcement
describe('Admin Role Guard', () => {
  it('should reject non-admin users', async () => {
    await expect(adminController.reindex(dto, userReq))
      .rejects.toThrow(ForbiddenException);
  });

  it('should allow admin users', async () => {
    await expect(adminController.reindex(dto, adminReq))
      .resolves.toBeDefined();
  });
});
```

### Integration Test Flow
```typescript
// Full admin auth flow test
1. Authenticate as regular user → 403 Forbidden
2. Authenticate as staff → 403 Forbidden  
3. Assign admin role → 200 OK
4. Authenticate as admin → 200 OK
5. Revoke admin role → 403 Forbidden
```

## Emergency Contacts

- **Security Team**: security@niffyinsure.com
- **DevOps Lead**: devops@niffyinsure.com
- **Engineering Manager**: engineering@niffyinsure.com

## Troubleshooting

### Common Issues

#### Admin Access Denied
```bash
# Check role assignment
SELECT role, kind FROM auth_identities WHERE wallet_address = 'G...';

# Check guard logs
grep "Admin access denied" /var/log/niffyinsure/app.log
```

#### Role Assignment Not Working
```bash
# Clear authentication cache
redis-cli FLUSHDB

# Restart application
npm run restart
```

#### Audit Trail Missing
```bash
# Check audit service status
curl -H "Authorization: Bearer <token>" \
     https://api.niffyinsure.com/admin/audit/status

# Verify database connection
psql $DATABASE_URL -c "SELECT COUNT(*) FROM admin_audit_logs;"
```

## Compliance Requirements

### GDPR/CCPA Considerations
- Role assignments are logged and auditable
- Data access is tracked and monitored
- Role removal requests processed within 30 days

### SOX Compliance
- Segregation of duties maintained
- Access reviews documented
- Changes approved and audited

### Industry Standards
- Follow NIST Cybersecurity Framework
- ISO 27001 access control procedures
- Regular penetration testing
