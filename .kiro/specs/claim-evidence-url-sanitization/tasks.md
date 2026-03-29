# Implementation Plan: Claim Evidence URL Sanitization

## Overview

Implement a `UrlValidatorService` that enforces a hot-reloadable gateway allowlist and SSRF
prevention rules. Wire it into `SanitizationService`, `ClaimsService`, and `IpfsService`.
Add a `SecurityLoggerService` that emits structured, PII-safe rejection events. Extend
`env.validation.ts` with the `ALLOWED_IPFS_GATEWAYS` schema entry.

## Tasks

- [ ] 1. Extend env config with ALLOWED_IPFS_GATEWAYS
  - Add `ALLOWED_IPFS_GATEWAYS` Joi entry to `backend/src/config/env.validation.ts` with
    default value `ipfs.io,cloudflare-ipfs.com,gateway.pinata.cloud,dweb.link,nftstorage.link`
  - Add custom validator that rejects entries containing whitespace or `/`
  - Reject empty value when `NODE_ENV=production`
  - _Requirements: 1.1, 1.2, 1.3, 1.5_

  - [ ]* 1.1 Write property test for env schema validation (PBT-7)
    - **Property 7: Env schema rejects invalid gateway entries**
    - **Validates: Requirements 1.3**
    - Tag: `Feature: claim-evidence-url-sanitization, Property 7`

- [ ] 2. Implement SecurityLoggerService
  - Create `backend/src/claims/security-logger.service.ts`
  - Implement `logRejection(originalUrl, reason, claimId?)` that:
    - Computes SHA-256 hex of `originalUrl` as `redactedHash`
    - Emits `warn`-level NestJS Logger entry with `{ redactedHash, claimId, reason, timestamp }`
    - Tracks per-hash rejection counts in a sliding 60-second window
    - Emits `error`-level entry when count exceeds 10 in the window
    - Never includes `originalUrl` in any log field
  - Export `SanitizationEvent` and `RejectionReason` types
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ]* 2.1 Write property test for log entry safety (PBT-4)
    - **Property 4: Security log entries never contain the original URL**
    - **Validates: Requirements 5.1, 5.2**
    - Tag: `Feature: claim-evidence-url-sanitization, Property 4`

  - [ ]* 2.2 Write unit test for rate-based error escalation
    - Simulate 11 rejections of the same URL within 60 s; verify `error`-level log is emitted
    - _Requirements: 5.3_

- [ ] 3. Implement UrlValidatorService — response-path validation
  - Create `backend/src/claims/url-validator.service.ts`
  - Export `PLACEHOLDER_URL = 'redacted:non-allowlisted-url'`
  - Implement `validateForResponse(url, claimId?)`:
    - Return Placeholder_URL for null/empty input (reason: `malformed-url`)
    - Return Placeholder_URL if URL cannot be parsed (reason: `malformed-url`)
    - Return Placeholder_URL for `file://` scheme (reason: `file-scheme`)
    - Return Placeholder_URL for non-`https` scheme (reason: `scheme-not-https`)
    - Return Placeholder_URL for non-standard port (reason: `non-standard-port`)
    - Return Placeholder_URL if hostname not in allowlist (reason: `hostname-not-allowlisted`)
    - Return original URL (normalized) if all checks pass
    - Call `SecurityLoggerService.logRejection` on every rejection
  - Load allowlist from `ConfigService` (`ALLOWED_IPFS_GATEWAYS`), split on `,`, trim entries
  - Include JSDoc block documenting the allowlist update process (Req 7.1–7.3)
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.2, 3.3, 7.1, 7.2, 7.3_

  - [ ]* 3.1 Write property tests for response-path validation (PBT-1, PBT-2)
    - **Property 1: Allowlisted https URLs pass validation unchanged**
    - **Property 2: Non-allowlisted or unsafe URLs always yield the Placeholder_URL**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 3.2, 3.3**
    - Tag: `Feature: claim-evidence-url-sanitization, Property 1` and `Property 2`

- [ ] 4. Implement UrlValidatorService — SSRF fetch-path validation
  - Add `validateForFetch(url, claimId?)` to `UrlValidatorService`:
    - Run all response-path checks first
    - Resolve hostname via `dns.promises.lookup` (with 5 s timeout)
    - Reject if resolved IP is in any Private_IP_Range (10/8, 172.16/12, 192.168/16,
      127/8, ::1, 169.254/16, fe80::/10, fc00::/7, 0.0.0.0/8)
    - Return Placeholder_URL on DNS failure (reason: `dns-resolution-failed`)
    - Return Placeholder_URL on private IP (reason: `private-ip-range`)
  - _Requirements: 3.1, 3.4_

  - [ ]* 4.1 Write property test for private-IP rejection (PBT-3)
    - **Property 3: Private-IP URLs are rejected by the fetch validator**
    - **Validates: Requirements 3.1**
    - Tag: `Feature: claim-evidence-url-sanitization, Property 3`

  - [ ]* 4.2 Write unit tests for DNS failure and timeout paths
    - Mock `dns.promises.lookup` to throw; verify Placeholder_URL returned
    - _Requirements: 3.4_

- [ ] 5. Implement hot-reload scheduler
  - Add `reloadAllowlist()` method to `UrlValidatorService` that re-reads
    `ALLOWED_IPFS_GATEWAYS` from `ConfigService` and updates the in-memory set
  - Schedule `reloadAllowlist()` on a 60-second interval using `setInterval` in `onModuleInit`
  - Clear the interval in `onModuleDestroy`
  - _Requirements: 1.4_

  - [ ]* 5.1 Write property test for hot-reload (PBT-6)
    - **Property 6: Allowlist hot-reload is reflected within one reload cycle**
    - **Validates: Requirements 1.4**
    - Tag: `Feature: claim-evidence-url-sanitization, Property 6`

- [ ] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Wire UrlValidatorService into SanitizationService
  - Inject `UrlValidatorService` into `SanitizationService`
  - Replace the hardcoded `allowedDomains` set and the body of `sanitizeEvidenceUrl` with a
    delegation to `urlValidator.validateForResponse(url)`
  - Remove the now-unused `allowedDomains` private field
  - _Requirements: 2.5_

- [ ] 8. Wire UrlValidatorService into ClaimsService response transformation
  - Verify `ClaimsService.transformClaim` calls `sanitization.sanitizeEvidenceUrl` for every
    URL in `imageUrls` (it already does via `extractEvidenceHash` — confirm coverage)
  - Ensure `evidence.gatewayUrl` is built only from a validated URL; if the validated result
    is Placeholder_URL, set `evidence.gatewayUrl` to Placeholder_URL (not a gateway-prefixed
    version of it)
  - _Requirements: 4.1, 4.2, 4.3_

  - [ ]* 8.1 Write property test for ClaimsService response transformation (PBT-5)
    - **Property 5: ClaimsService response transformation replaces all unsafe URLs**
    - **Validates: Requirements 4.1, 4.2, 2.5**
    - Tag: `Feature: claim-evidence-url-sanitization, Property 5`

  - [ ]* 8.2 Write unit test for HTTP 200 with placeholder
    - Verify `GET /claims/:id` returns 200 when all evidence URLs are replaced with placeholder
    - _Requirements: 4.3_

- [ ] 9. Wire UrlValidatorService into IpfsService
  - Inject `UrlValidatorService` into `IpfsService`
  - Before any outbound HTTP request that uses a URL derived from claim evidence, call
    `urlValidator.validateForFetch(url)`
  - If result is not safe, throw `BadRequestException('Evidence URL failed security validation')`
    (no original URL in the message)
  - _Requirements: 3.5_

  - [ ]* 9.1 Write unit test for IpfsService SSRF guard
    - Mock `UrlValidatorService.validateForFetch` to return Placeholder_URL; verify
      `BadRequestException` is thrown and original URL is not in the exception message
    - _Requirements: 3.5_

- [ ] 10. Register new services in ClaimsModule
  - Add `UrlValidatorService` and `SecurityLoggerService` to `ClaimsModule` providers
  - Ensure `ConfigModule` is imported in `ClaimsModule` (or is global)
  - _Requirements: 1.1_

- [ ] 11. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each property test must run a minimum of 100 `fast-check` iterations
- The `PLACEHOLDER_URL` constant must be exported from `url-validator.service.ts` so tests and
  API documentation can reference it without magic strings
- Security logs must never contain the original URL — this is enforced by Property 4 (PBT-4)
- The `generateGatewayUrls` function in `ipfs-provider.interface.ts` hardcodes gateway
  hostnames; after this feature lands, those hostnames should be kept in sync with the default
  `ALLOWED_IPFS_GATEWAYS` value
