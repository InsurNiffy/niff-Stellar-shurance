# Security Documentation - Staff Authentication & RBAC

## Overview

This document describes the security measures implemented for staff authentication and role-based access control (RBAC) in the Niffy Insure backend.

## Authentication Flow

### Login Process

Staff authenticate using email and password via `POST /api/auth/login`:

```
POST /api/auth/login
Content-Type: application/json

{
  "email": "admin@example.com",
  "password": "securepassword"
}
```

Response:
```json
{
  "accessToken": "eyJhbGciOiJIUzI1...",
  "refreshToken": "eyJhbGciOiJIUzI1...",
  "user": {
    "id": "uuid",
    "email": "admin@example.com",
    "role": "admin"
  }
}
```

### Token Usage

Include the access token in the `Authorization` header:
```
Authorization: Bearer <access_token>
```

### Token Refresh

Use the refresh token to obtain a new access token via `POST /api/auth/refresh`:

```
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJIUzI1..."
}
```

## Password Security

- Passwords are hashed using **bcrypt** with salt rounds configured in `config.security.bcryptRounds` (default: 12)
- Raw passwords are never stored or logged
- Password verification failures are logged without exposing credentials

## Role-Based Access Control (RBAC)

### Roles

| Role | Description | Permissions |
|------|-------------|-------------|
| `admin` | Full system administrator | All permissions |
| `support_readonly` | Support staff with read-only access | `read:claims`, `read:policies`, `read:users`, `read:audit` |

### Permission Matrix

```typescript
const ROLE_PERMISSIONS = {
  admin: [
    'read:claims', 'write:claims',
    'read:policies', 'write:policies',
    'read:users', 'write:users',
    'read:audit', 'write:audit',
    'read:settings', 'write:settings',
    'read:reports'
  ],
  support_readonly: [
    'read:claims', 'read:policies', 'read:users', 'read:audit'
  ]
};
```

### Support Staff Limitations

Support staff (`support_readonly` role):
- Can view claims, policies, users, and audit logs
- Cannot create, update, or delete any resources
- Cannot access system settings or administrative functions
- Cannot generate reports

## Token Configuration

### Access Token

- **Expiry**: 15 minutes (configurable via `config.jwt.accessTokenExpiry`)
- **Algorithm**: HS256
- **Payload**: `{ id, email, role, iat, exp }`

### Refresh Token

- **Expiry**: 7 days (configurable via `config.jwt.refreshTokenExpiry`)
- **Algorithm**: HS256
- **Payload**: `{ id, email, role, iat, exp, type: 'refresh' }`

## Security Headers

The following security headers are enforced via Helmet:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `Content-Security-Policy` (customizable)

## CORS Configuration

CORS is configured to allow specific origins (configurable via `config.security.corsOrigins`). In production, restrict to known frontend domains.

## Rate Limiting

- **Login attempts**: 5 requests per 15 minutes per IP
- **General API**: 100 requests per 15 minutes per IP
- Rate limit headers are included in responses (`X-RateLimit-Limit`, `X-RateLimit-Remaining`)

## Logging Security

Authentication failures are logged without exposing sensitive information:
- ✅ Logged: email (partial), IP, timestamp, failure reason
- ❌ Not logged: passwords, tokens, full user details

Example log output:
```
[AUTH] Login failed for user: admin@***.com from IP: 192.168.1.1 - Invalid credentials
[AUTH] Token verification failed: TokenExpiredError
[AUTH] Role check failed: user support@example.com with role support_readonly attempted to access POST /admin/users requiring admin
```

## Threat Model

### XSS (Cross-Site Scripting)

**Risk**: Attackers could steal JWT tokens stored in browser localStorage.

**Mitigation**:
- Consider using httpOnly cookies for token storage (requires CSRF protection)
- Implement token rotation on suspicious activity
- Set short expiry for access tokens (15 min)
- Frontend should implement Content Security Policy

**Recommendation**: For production, implement httpOnly secure cookies with CSRF tokens.

### CSRF (Cross-Site Request Forgery)

**Risk**: Attackers could make authenticated requests on behalf of users.

**Mitigation**:
- Use `SameSite` cookie attribute (strict/lax)
- Implement CSRF token validation for state-changing operations
- Use double-submit cookie pattern

**Production Setup**: When using cookies, implement CSRF protection.

### Token Theft

**Risk**: Tokens could be intercepted in transit or stolen from storage.

**Mitigation**:
- Enforce HTTPS in production (see below)
- Short access token expiry (15 min)
- Refresh token rotation on use
- Implement token revocation mechanism

### Brute Force Attacks

**Risk**: Attackers could guess passwords via brute force.

**Mitigation**:
- Rate limiting on login endpoint (5 attempts per 15 min)
- bcrypt with high salt rounds (12)
- Account lockout after failed attempts (future enhancement)

## Production Requirements

### HTTPS Enforcement

⚠️ **Critical**: The application MUST be deployed behind HTTPS in production.

```bash
# Environment variables for production
NODE_ENV=production
FORCE_SSL=true
```

Configuration for reverse proxy (nginx example):
```nginx
server {
    listen 443 ssl http2;
    server_name api.niffyinsure.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Secure Cookie Configuration

When using cookies for token storage, configure:

```typescript
// Example cookie options for production
const cookieOptions = {
  httpOnly: true,
  secure: true,        // HTTPS only
  sameSite: 'strict',  // CSRF protection
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/'
};
```

### Environment Variables

Required production configuration:

```bash
# JWT Configuration
JWT_SECRET=<minimum-256-bit-secret>
JWT_REFRESH_SECRET=<minimum-256-bit-secret>

# Security
BCRYPT_ROUNDS=12
NODE_ENV=production

# HTTPS (via reverse proxy)
# FORCE_SSL=true
```

## Key Rotation

### JWT Signing Keys

**Recommendation**: Rotate JWT signing keys periodically.

Implementation approach:
1. Maintain multiple key versions in configuration
2. Use key ID (`kid`) in JWT header to identify which key was used
3. Accept tokens signed by current and previous keys during transition
4. Schedule key rotation every 90 days

```typescript
// Key rotation configuration
const jwtOptions = {
  issuer: 'niffyinsure',
  audience: 'niffyinsure-api',
  algorithm: 'HS256',
  keyid: 'key-v1'  // Rotate this value when changing keys
};
```

### Refresh Token Rotation

- Each refresh creates a new refresh token
- Store refresh tokens in database for revocation capability
- Invalidate refresh tokens on password change or logout
- Implement token blacklist for immediate revocation

## MFA Roadmap

Multi-factor authentication is planned for future implementation:

### Phase 1 (Post-Launch)
- TOTP-based authenticator apps (Google Authenticator, Authy)
- Recovery codes

### Phase 2
- Email-based verification for sensitive actions
- Session management (view/revoke active sessions)

### Phase 3
- SMS/Email OTP for login confirmation
- Hardware security keys (WebAuthn/FIDO2)

### Implementation Notes

```typescript
// Future MFA types
interface MFAMethods {
  totp: boolean;
  email: boolean;
  sms: boolean;
  webauthn: boolean;
}

// Login flow with MFA
interface LoginResponse {
  accessToken: string;
  mfaRequired: boolean;
  mfaMethod: 'totp' | 'email' | 'sms';
}

// Second factor verification endpoint
POST /api/auth/verify-mfa
{
  "tempToken": "...",
  "code": "123456"
}
```

## Security Testing

### Test Matrix (Implemented)

| Scenario | Expected Status |
|----------|-----------------|
| No auth header on protected route | 401 Unauthorized |
| Invalid token format | 401 Unauthorized |
| Expired token | 401 Unauthorized |
| Valid token, insufficient role | 403 Forbidden |
| Valid token, correct role | 200 OK |

Run tests:
```bash
npm test
```

### Additional Security Tests (Recommended)

- Rate limiting effectiveness
- SQL injection prevention
- XSS prevention in error messages
- Password strength requirements
- Session timeout verification

## API Endpoints Summary

| Endpoint | Method | Auth Required | Role Required |
|----------|--------|---------------|---------------|
| `/api/auth/login` | POST | No | - |
| `/api/auth/refresh` | POST | No | - |
| `/api/auth/me` | GET | Yes | Any |
| `/api/auth/logout` | POST | Yes | Any |
| `/api/admin/dashboard` | GET | Yes | admin |
| `/api/admin/users` | GET/POST | Yes | admin |
| `/api/admin/users/:id` | GET/PUT/DELETE | Yes | admin |
| `/api/admin/policies` | GET/POST | Yes | admin |
| `/api/admin/claims` | GET/POST | Yes | admin |
| `/api/admin/audit` | GET | Yes | admin/support_readonly |
| `/api/admin/settings` | GET/PUT | Yes | admin |
| `/api/admin/reports` | GET | Yes | admin |

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [JWT Best Practices](https://datatracker.ietf.org/doc/html/rfc8725)
- [Helmet.js](https://helmetjs.github.io/)
- [Express Rate Limit](https://github.com/express-rate-limit/express-rate-limit)
- [BCrypt](https://github.com/kelektiv/node.bcrypt.js)