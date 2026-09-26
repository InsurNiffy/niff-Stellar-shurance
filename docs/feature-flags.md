# Feature Flags

Feature flags enable runtime toggling of application features without code deployments. Flags are stored in the database and can be managed via the admin API.

## Database Schema

Feature flags are stored in the `feature_flag` table:

```sql
CREATE TABLE feature_flag (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## API Endpoints

### List Feature Flags

```
GET /admin/feature-flags
```

Returns all feature flags with their current state.

**Response:**
```json
[
  {
    "key": "experimental_feature",
    "enabled": true,
    "description": "Enable experimental UI features",
    "updatedBy": "admin@example.com",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
]
```

### Read a Single Feature Flag (public)

```
GET /api/feature-flags/{key}
```

Read-only view of one allowlisted flag, used by the frontend `useFeatureFlag`
hook so the UI gates on the same key the backend gates its endpoints with.
Keys outside `ALLOWED_FLAG_KEYS` return 404.

**Response:**
```json
{ "key": "claims_appeal_enabled", "enabled": true }
```

### Update Feature Flag

```
PATCH /admin/feature-flags/{key}
```

Updates the enabled state and description of a feature flag.

**Request Body:**
```json
{
  "enabled": true,
  "description": "Updated description"
}
```

**Response:** The updated feature flag record.

## Usage in Code

Inject `FeatureFlagsService` and check flag status:

```typescript
constructor(private readonly featureFlags: FeatureFlagsService) {}

async someMethod() {
  if (this.featureFlags.isEnabled('experimental_feature')) {
    // Enable experimental behavior
  }
}
```

## Guards

Use `FeatureFlagsGuard` to protect routes:

```typescript
@UseGuards(FeatureFlagsGuard)
@Get('experimental-endpoint')
async experimentalEndpoint(@FeatureFlag('experimental_feature') flag: boolean) {
  // Only accessible if flag is enabled
}
```

## Environment Variables

- `FEATURE_FLAGS_DISABLED_STATUS`: HTTP status code to return when feature is disabled (403 or 404, default 404)

## Initialization

Feature flags are loaded from the database on application startup. The service implements `OnModuleInit` to ensure flags are available immediately.

## Admin Updates

When flags are updated via the admin API, the in-memory cache is refreshed automatically to ensure immediate effect without restart.

## Security Considerations

- Feature flag keys should be descriptive but not reveal sensitive information
- Admin API endpoints require authentication
- All flag updates are audited with the `updated_by` field
- Disabled features return configurable HTTP status codes to avoid information leakage

## Cleanup audits

Flag names and lifecycle stages (experimental / rolled-out / deprecated) follow the shared
convention in [`docs/feature-flag-naming-convention.md`](./feature-flag-naming-convention.md),
which also contains the current audit of every key in `ALLOWED_FLAG_KEYS` against that
convention. When periodically auditing flags for cleanup/removal, check each flag's lifecycle
stage there first — `deprecated` flags whose guarded code has already been deleted are safe to
remove immediately; `rolled-out` flags with no remaining kill-switch value are candidates for
the same.