# Implementation Plan: Claim Rate Limiting

## Overview

This implementation plan breaks down the claim rate limiting feature into discrete coding tasks. The system will track claim counts per policy within rolling time windows, enforce configurable limits with absolute maximum bounds, provide clear error messages, maintain audit logs, and support manual overrides for catastrophic events.

The implementation uses Redis for O(1) counter operations, NestJS guards for request interception, and integrates with the existing AdminAuditLog infrastructure.

## Tasks

- [x] 1. Set up rate limiting module structure and constants
  - Create `backend/src/rate-limit/` directory
  - Create `rate-limit.module.ts` with module definition
  - Create `rate-limit.constants.ts` with default configuration values (DEFAULT_LIMIT: 5, WINDOW_SIZE_LEDGERS: 17280, ABSOLUTE_MAX_CAP: 100, CACHE_TTL_SECONDS: 300)
  - Export module from the rate-limit directory
  - _Requirements: 2.6, 6.1, 6.2, 6.3_

- [x] 2. Implement core rate limit service
  - [x] 2.1 Create RateLimitService class with Redis integration
    - Create `rate-limit.service.ts` with injectable service
    - Inject RedisService and ConfigService dependencies
    - Define Redis key schema constants (counter, config, defaults)
    - Implement helper method to get window size from Redis defaults
    - Implement helper method to get effective limit (custom or default)
    - _Requirements: 1.4, 1.5, 2.6, 7.1, 7.2, 7.4_

  - [ ]* 2.2 Write property test for effective limit retrieval
    - **Property 8: Default limit fallback**
    - **Validates: Requirements 2.6**

  - [x] 2.3 Implement window reset logic
    - Create `checkAndResetWindow` private method
    - Handle first claim case (initialize counter and anchor)
    - Check if current ledger exceeds window boundary
    - Reset counter and update anchor when window expires
    - Return current count and anchor for active windows
    - _Requirements: 1.2, 1.3, 6.4_

  - [ ]* 2.4 Write property test for window reset
    - **Property 3: Window reset round-trip**
    - **Validates: Requirements 1.3**

  - [x] 2.5 Implement checkAndIncrement method
    - Call checkAndResetWindow to get current state
    - Check if override is active for the policy
    - If override active, increment counter and return allowed=true
    - Get effective limit for the policy
    - If count >= limit, return allowed=false with details
    - If count < limit, increment counter using Redis HINCRBY
    - Return RateLimitCheckResult with all required fields
    - _Requirements: 1.1, 2.1, 5.1, 7.1_

  - [ ]* 2.6 Write property tests for counter and rate limiting
    - **Property 1: Counter increment on claim filing**
    - **Property 4: Rate limit enforcement at boundary**
    - **Validates: Requirements 1.1, 2.1**

- [x] 3. Implement admin configuration methods
  - [x] 3.1 Create setLimit method
    - Validate limit is between 1 and ABSOLUTE_MAX_CAP
    - Throw BadRequestException if validation fails
    - Store custom limit in Redis config hash for policy
    - Return void on success
    - _Requirements: 2.3, 2.4, 2.5_

  - [ ]* 3.2 Write property tests for limit configuration
    - **Property 6: Admin configuration updates effective limit**
    - **Property 7: Absolute max cap enforcement**
    - **Validates: Requirements 2.3, 2.4, 2.5**

  - [x] 3.3 Create override management methods
    - Implement `enableOverride` method to set override flag in Redis
    - Implement `disableOverride` method to remove override flag
    - Implement `getCounterState` method to return current counter state
    - _Requirements: 5.1, 5.2, 5.5_

  - [ ]* 3.4 Write property test for override behavior
    - **Property 11: Override bypasses rate limits**
    - **Property 12: Override enable/disable round-trip**
    - **Validates: Requirements 5.1, 5.2, 5.5_

- [x] 4. Create custom exception and DTOs
  - [x] 4.1 Create RateLimitException class
    - Create `rate-limit.exception.ts` file
    - Extend HttpException with status 429
    - Accept RateLimitErrorDetails interface
    - Format error message with policy ID, count, limit, and reset information
    - Include details object in response body
    - _Requirements: 2.2, 3.1, 3.3, 3.4_

  - [ ]* 4.2 Write property test for error message completeness
    - **Property 5: Rate limit error completeness**
    - **Validates: Requirements 2.2, 3.1, 3.4**

  - [x] 4.3 Create admin DTOs
    - Create `backend/src/admin/dto/rate-limit.dto.ts`
    - Define SetRateLimitDto with limit field (1-100 validation)
    - Define EnableOverrideDto with reason field (min 10 chars)
    - Export DTOs
    - _Requirements: 2.4, 5.3_

- [ ] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement rate limit guard
  - [x] 6.1 Create RateLimitGuard class
    - Create `rate-limit.guard.ts` implementing CanActivate
    - Inject RateLimitService and SorobanService
    - Extract policyId from request body
    - Return true if policyId is missing (let validation handle it)
    - Get current ledger from SorobanService
    - Call rateLimitService.checkAndIncrement
    - Throw RateLimitException if not allowed
    - Return true if allowed
    - _Requirements: 2.1, 2.2, 3.1, 3.4_

  - [ ]* 6.2 Write integration tests for guard
    - Test guard allows claim when under limit
    - Test guard blocks claim when at limit
    - Test guard throws RateLimitException with correct details
    - Test guard passes through when policyId missing
    - _Requirements: 2.1, 2.2_

- [x] 7. Add admin endpoints to AdminController
  - [x] 7.1 Add rate limit configuration endpoints
    - Add POST `/admin/rate-limits/:policyId` endpoint
    - Call rateLimitService.setLimit with validated DTO
    - Write audit log entry with action 'rate_limit_set'
    - Return success response with policy ID and new limit
    - Add GET `/admin/rate-limits/:policyId` endpoint to retrieve current state
    - _Requirements: 2.3, 4.1, 4.2, 4.3, 4.4_

  - [x] 7.2 Add override management endpoints
    - Add POST `/admin/rate-limits/:policyId/override` endpoint
    - Call rateLimitService.enableOverride with reason
    - Write audit log entry with action 'rate_limit_override_enabled'
    - Add DELETE `/admin/rate-limits/:policyId/override` endpoint
    - Call rateLimitService.disableOverride
    - Write audit log entry with action 'rate_limit_override_disabled'
    - _Requirements: 5.2, 5.3, 4.1, 4.2, 4.3, 4.4_

  - [ ]* 7.3 Write integration tests for admin endpoints
    - Test POST /admin/rate-limits/:policyId sets custom limit
    - Test POST with limit > max returns 400
    - Test POST /admin/rate-limits/:policyId/override enables override
    - Test DELETE /admin/rate-limits/:policyId/override disables override
    - Test GET /admin/rate-limits/:policyId returns current state
    - Test all endpoints require authentication (401 without JWT)
    - Test all endpoints require admin role (403 without admin role)
    - Test all actions write audit logs
    - _Requirements: 2.3, 2.4, 2.5, 5.2, 5.4, 5.5, 4.1, 4.2, 4.3, 4.4_

  - [ ]* 7.4 Write property test for audit log completeness
    - **Property 10: Audit log completeness for configuration changes**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 5.3**

- [x] 8. Integrate guard with claims controller
  - [x] 8.1 Apply RateLimitGuard to claim submission endpoint
    - Add @UseGuards(RateLimitGuard) decorator to submitTransaction method in ClaimsController
    - Ensure guard runs before the service method
    - Update API documentation to mention rate limiting
    - _Requirements: 2.1, 7.3_

  - [ ]* 8.2 Write end-to-end integration tests
    - Test full claim submission flow with rate limiting
    - Test sequence approaching limit (4 claims with limit=5)
    - Test sequence exceeding limit by one (6 claims with limit=5)
    - Test window rollover scenario (claims, advance ledger, verify reset)
    - Test concurrent claims at boundary using Promise.all
    - Test normal usage remains unaffected (single claim, verify latency)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Add error handling and fail-open behavior
  - [x] 10.1 Implement Redis failure handling
    - Wrap Redis operations in try-catch blocks
    - Log warnings when Redis is unavailable
    - Return allowed=true (fail open) when Redis fails
    - Add ServiceUnavailableException for critical failures
    - _Requirements: 7.3_

  - [ ]* 10.2 Write unit tests for error scenarios
    - Test Redis connection failure causes fail-open
    - Test invalid policyId format is passed through
    - Test policy not found allows claim to proceed
    - Test concurrent claims at boundary (atomic HINCRBY)
    - _Requirements: 7.3_

- [x] 11. Initialize Redis defaults on module startup
  - [x] 11.1 Create initialization logic
    - Implement onModuleInit in RateLimitService
    - Check if rate_limit:defaults key exists in Redis
    - If not exists, initialize with RATE_LIMIT_DEFAULTS values
    - Log initialization status
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 12. Add OpenAPI documentation
  - [x] 12.1 Document rate limit responses
    - Add @ApiResponse decorators for 429 status to claim endpoints
    - Document RateLimitException response schema
    - Add examples showing error message format
    - Document admin endpoints with request/response schemas
    - _Requirements: 3.3_

- [ ] 13. Final checkpoint and validation
  - Run full test suite (unit, integration, property-based)
  - Verify all requirements are covered by tests
  - Check that fail-open behavior works correctly
  - Verify audit logs are written for all admin actions
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property-based tests use fast-check library (install with `npm install --save-dev fast-check`)
- Redis operations use atomic commands (HINCRBY) to prevent race conditions
- The system fails open (allows claims) when Redis is unavailable to avoid blocking legitimate users
- All admin actions require JWT authentication and admin role authorization
- Audit logs are append-only and must never be updated or deleted
