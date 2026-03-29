# Requirements Document

## Introduction

Evidence URLs stored on-chain and returned by the claims API could point to internal network
addresses if not validated, enabling Server-Side Request Forgery (SSRF) attacks via the
backend's IPFS fetch or preview endpoints. This feature hardens the claims pipeline by
validating all evidence URLs against a configurable gateway allowlist before they are returned
to clients or fetched server-side, replacing non-allowlisted URLs with a safe placeholder in
API responses, and blocking SSRF attempts at the validation layer.

## Glossary

- **Evidence_URL**: A URL stored in a claim's `imageUrls` field that points to IPFS-hosted
  evidence content.
- **Allowlist**: The ordered set of permitted IPFS gateway hostnames, loaded from environment
  configuration and hot-reloadable without a service restart.
- **Placeholder_URL**: The static, safe string `"redacted:non-allowlisted-url"` substituted
  for any Evidence_URL that fails allowlist or SSRF validation.
- **SSRF**: Server-Side Request Forgery — an attack where a crafted URL causes the server to
  make unintended requests to internal or restricted network resources.
- **Private_IP_Range**: IPv4/IPv6 address ranges reserved for internal use (RFC 1918, loopback,
  link-local, and IPv6 ULA), plus the `file://` scheme.
- **Sanitization_Service**: The existing `SanitizationService` class at
  `backend/src/claims/sanitization.service.ts`, extended by this feature.
- **URL_Validator**: The new injectable service responsible for allowlist checking and SSRF
  prevention, introduced by this feature.
- **Security_Logger**: The structured logging facility that records sanitization events without
  storing the original malicious URL.
- **Redacted_Hash**: A one-way SHA-256 hash of the original URL, used in security log entries
  in place of the raw URL.
- **Config_Service**: NestJS `ConfigService` backed by the validated environment schema in
  `backend/src/config/env.validation.ts`.
- **Hot_Reload**: The ability to pick up a changed `ALLOWED_IPFS_GATEWAYS` environment value
  (or config file) without restarting the NestJS process.

---

## Requirements

### Requirement 1: Gateway Allowlist Configuration

**User Story:** As a platform operator, I want to define the set of permitted IPFS gateway
hostnames via environment configuration, so that I can update the allowlist per environment
without modifying or redeploying code.

#### Acceptance Criteria

1. THE Config_Service SHALL expose an `ALLOWED_IPFS_GATEWAYS` configuration key whose value
   is a comma-separated list of hostnames (e.g. `ipfs.io,cloudflare-ipfs.com`).
2. WHEN `ALLOWED_IPFS_GATEWAYS` is absent from the environment, THE Config_Service SHALL fall
   back to a built-in default list containing at minimum `ipfs.io`, `cloudflare-ipfs.com`,
   `gateway.pinata.cloud`, `dweb.link`, and `nftstorage.link`.
3. THE env.validation.ts schema SHALL validate that every entry in `ALLOWED_IPFS_GATEWAYS` is
   a non-empty string containing no whitespace or path separators.
4. WHEN the `ALLOWED_IPFS_GATEWAYS` value changes at runtime (Hot_Reload), THE URL_Validator
   SHALL reflect the updated allowlist within 60 seconds without a service restart.
5. WHERE the runtime environment is `production`, THE Config_Service SHALL reject an empty
   `ALLOWED_IPFS_GATEWAYS` value and prevent application startup.

### Requirement 2: Evidence URL Allowlist Validation

**User Story:** As a security engineer, I want every evidence URL to be checked against the
gateway allowlist before it is returned to a client or used in a server-side fetch, so that
non-allowlisted URLs never reach clients or internal network calls.

#### Acceptance Criteria

1. WHEN an Evidence_URL is processed by the URL_Validator, THE URL_Validator SHALL parse the
   URL and verify that its hostname exactly matches an entry in the Allowlist (case-insensitive,
   no subdomain wildcards unless explicitly configured).
2. WHEN an Evidence_URL hostname does not match any Allowlist entry, THE URL_Validator SHALL
   return the Placeholder_URL instead of the original URL.
3. WHEN an Evidence_URL uses a scheme other than `https`, THE URL_Validator SHALL return the
   Placeholder_URL.
4. WHEN an Evidence_URL is malformed and cannot be parsed as a valid URL, THE URL_Validator
   SHALL return the Placeholder_URL.
5. THE ClaimsService SHALL pass every Evidence_URL through the URL_Validator before including
   it in any API response field (including `evidence.gatewayUrl` and `metadata.evidenceHash`
   derivation paths).
6. WHEN the URL_Validator replaces a URL with the Placeholder_URL, THE Security_Logger SHALL
   emit a structured log entry at `warn` level containing the Redacted_Hash of the original
   URL, the claim ID, and the reason for rejection — but SHALL NOT include the original URL
   string in the log entry.

### Requirement 3: SSRF Prevention for Server-Side URL Fetches

**User Story:** As a security engineer, I want all server-side HTTP requests that use an
Evidence_URL to be blocked if the resolved destination is a private or restricted address, so
that crafted URLs cannot be used to probe internal infrastructure.

#### Acceptance Criteria

1. WHEN the URL_Validator evaluates a URL for server-side use, THE URL_Validator SHALL resolve
   the hostname to its IP address(es) and reject the URL if any resolved address falls within a
   Private_IP_Range (RFC 1918: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16; loopback:
   127.0.0.0/8, ::1; link-local: 169.254.0.0/16, fe80::/10; IPv6 ULA: fc00::/7).
2. WHEN a URL uses the `file://` scheme, THE URL_Validator SHALL return the Placeholder_URL
   without performing any DNS resolution.
3. WHEN a URL uses a non-standard port (any port other than 443 for `https`), THE URL_Validator
   SHALL return the Placeholder_URL.
4. IF DNS resolution of a URL's hostname fails or times out, THEN THE URL_Validator SHALL
   return the Placeholder_URL and log the failure at `warn` level.
5. THE IpfsService SHALL invoke the URL_Validator's SSRF check before making any outbound HTTP
   request to a URL derived from claim evidence data.

### Requirement 4: Safe Placeholder in API Responses

**User Story:** As an API consumer, I want non-allowlisted or unsafe evidence URLs to be
replaced with a documented placeholder value in API responses, so that my client can detect
and handle sanitized URLs without receiving potentially dangerous content.

#### Acceptance Criteria

1. THE ClaimsService SHALL substitute the Placeholder_URL (`"redacted:non-allowlisted-url"`)
   for any Evidence_URL that fails allowlist or SSRF validation in the `GET /claims/:id`
   response body.
2. THE ClaimsService SHALL substitute the Placeholder_URL in the `GET /claims` (list) response
   for any Evidence_URL that fails validation.
3. WHEN the Placeholder_URL is present in a response, THE API SHALL return HTTP 200 (not an
   error status), allowing clients to display a fallback UI.
4. THE API documentation (Swagger/OpenAPI) SHALL describe the Placeholder_URL value and the
   conditions under which it appears.

### Requirement 5: Security Logging Without PII Leakage

**User Story:** As a security operations engineer, I want sanitization events to be logged in
a structured format that includes enough context for incident investigation, without storing
the original malicious URL, so that logs are safe to retain and forward to monitoring systems.

#### Acceptance Criteria

1. WHEN the URL_Validator rejects a URL, THE Security_Logger SHALL emit a log entry containing:
   the Redacted_Hash (SHA-256 hex of the original URL), the claim ID, the rejection reason
   (one of: `scheme-not-https`, `hostname-not-allowlisted`, `private-ip-range`,
   `dns-resolution-failed`, `malformed-url`, `non-standard-port`), and a UTC timestamp.
2. THE Security_Logger SHALL NOT include the original URL string in any log field, message, or
   metadata.
3. WHEN the same Redacted_Hash appears more than 10 times within a 60-second window, THE
   Security_Logger SHALL emit an additional `error`-level log entry indicating a potential
   repeated SSRF probe.
4. THE log entries SHALL be emitted using the existing NestJS `Logger` facility so they are
   captured by the application's configured log transport without additional infrastructure.

### Requirement 6: Test Coverage

**User Story:** As a developer, I want comprehensive automated tests for the URL validation
logic, so that regressions in security-critical code are caught immediately.

#### Acceptance Criteria

1. THE test suite SHALL include unit tests covering allowlisted URLs, non-allowlisted URLs,
   malformed URLs, `file://` URLs, private-IP URLs, and non-`https` scheme URLs.
2. THE test suite SHALL include property-based tests (using `fast-check`) that verify the
   URL_Validator returns the Placeholder_URL for all inputs that are not valid `https` URLs
   with an allowlisted hostname.
3. WHEN a URL passes allowlist validation, THE test suite SHALL verify that the original URL
   (or a normalized form) is returned, not the Placeholder_URL.
4. THE test suite SHALL verify that no original malicious URL string appears in any log output
   produced during sanitization.
5. THE test suite SHALL verify that the allowlist can be updated at runtime and that the
   URL_Validator reflects the change without restarting.

### Requirement 7: Allowlist Update Process Documentation

**User Story:** As a platform operator, I want a documented process for adding new IPFS gateway
providers to the allowlist, so that I can safely extend the allowlist without introducing
security regressions.

#### Acceptance Criteria

1. THE codebase SHALL include inline documentation (code comments or a dedicated section in the
   module README) describing the steps to add a new gateway hostname to `ALLOWED_IPFS_GATEWAYS`.
2. THE documentation SHALL specify that new hostnames must use `https` and must not resolve to
   Private_IP_Ranges before being added.
3. THE documentation SHALL describe how to apply the change per environment (development,
   staging, production) without a service restart.
