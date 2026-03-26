# Implementation Plan: CORS & Helmet Security Headers

## Overview

Harden the NestJS backend's security posture by replacing the wildcard CORS setup with an environment-driven origin allowlist, tuning Helmet for a JSON-only API, and covering all flows with integration and property-based tests.

## Tasks

- [x] 1. Install fast-check and update env validator
  - [x] 1.1 Install fast-check as a dev dependency
    - Run `npm install --save-dev fast-check` in the `backend` directory
    - _Requirements: 6 (testing infrastructure)_

  - [x] 1.2 Update `env.validation.ts` to add `FRONTEND_ORIGINS` and `ADMIN_CORS_ORIGINS`
    - Add `FRONTEND_ORIGINS`: required string, no default
    - Add `ADMIN_CORS_ORIGINS`: optional string, default `''`
    - Remove or deprecate the existing `CORS_ORIGINS` field
    - Add a Joi `.custom()` rule: when `NODE_ENV=production`, every comma-separated entry in `FRONTEND_ORIGINS` must start with `https://` and none may equal `*`
    - Add a Joi `.custom()` rule: when `NODE_ENV=production`, any `http://` entry causes a descriptive startup error
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 5.1, 5.2_

  - [ ]\* 1.3 Write unit tests for the Joi env validator
    - Test: missing `FRONTEND_ORIGINS` → validation error
    - Test: `FRONTEND_ORIGINS=*` with `NODE_ENV=production` → validation error
    - Test: `FRONTEND_ORIGINS=http://localhost:3001` with `NODE_ENV=development` → valid
    - Test: `FRONTEND_ORIGINS=http://example.com` with `NODE_ENV=production` → validation error
    - _Requirements: 1.3, 1.4, 1.5, 5.2_

- [x] 2. Implement `parseOrigins` utility and CORS middleware in `main.ts`
  - [x] 2.1 Add `parseOrigins` pure function to `main.ts`
    - Splits on `,`, trims each entry, filters empty strings
    - _Requirements: 1.1, 1.2, 1.6_

  - [x]\* 2.2 Write property test for `parseOrigins` — Property 1
    - **Property 1: Origin list parsing preserves trimmed values**
    - **Validates: Requirements 1.1, 1.2, 1.6**
    - File: `backend/src/__tests__/cors.property.test.ts`
    - Tag: `Feature: cors-helmet-security-headers, Property 1`

  - [x] 2.3 Replace existing CORS setup in `main.ts` with the origin-callback implementation
    - Read `FRONTEND_ORIGINS` and `ADMIN_CORS_ORIGINS` via `ConfigService`, parse with `parseOrigins`
    - Call `app.enableCors(...)` with the origin callback that echoes the exact origin for allowlisted requests, passes through requests with no `Origin`, and calls `cb(new Error(...), false)` for disallowed origins
    - Set `credentials: true`, `methods`, `allowedHeaders`, `maxAge: 86400`, `optionsSuccessStatus: 204`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3_

  - [x]\* 2.4 Write property test for allowed origin echoed — Property 2
    - **Property 2: Allowed origin is echoed in response**
    - **Validates: Requirements 2.1**
    - Test the origin callback function directly (no HTTP needed)
    - Tag: `Feature: cors-helmet-security-headers, Property 2`

  - [x]\* 2.5 Write property test for disallowed origin rejected — Property 3
    - **Property 3: Disallowed origin is rejected**
    - **Validates: Requirements 2.2, 3.2**
    - Test the origin callback function directly
    - Tag: `Feature: cors-helmet-security-headers, Property 3`

  - [x]\* 2.6 Write property test for credentials header — Property 4
    - **Property 4: Credentials header present for all allowed origins**
    - **Validates: Requirements 2.4**
    - Verify the CORS config object always has `credentials: true`
    - Tag: `Feature: cors-helmet-security-headers, Property 4`

  - [x]\* 2.7 Write property test for response headers completeness — Property 5
    - **Property 5: Allowed-origin response headers completeness**
    - **Validates: Requirements 2.6, 2.7**
    - Verify `allowedHeaders` and `methods` arrays always contain the required values
    - Tag: `Feature: cors-helmet-security-headers, Property 5`

  - [x]\* 2.8 Write property test for preflight completeness — Property 6
    - **Property 6: Preflight response completeness**
    - **Validates: Requirements 3.1, 3.3**
    - Verify `maxAge`, `optionsSuccessStatus: 204`, and credentials for any allowlisted origin
    - Tag: `Feature: cors-helmet-security-headers, Property 6`

- [x] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Configure Helmet middleware in `main.ts`
  - [x] 4.1 Replace the existing `helmet()` call with the JSON-API-tuned configuration
    - Set `contentSecurityPolicy` with `defaultSrc: ["'none'"]`
    - Set `hsts` with `maxAge: 31_536_000`, `includeSubDomains: true`, `preload: false`
    - Set `frameguard: { action: 'deny' }`
    - Set `dnsPrefetchControl: { allow: false }`
    - Set `referrerPolicy: { policy: 'no-referrer' }`
    - Set `permittedCrossDomainPolicies: false`, `crossOriginEmbedderPolicy: false`
    - Add a custom middleware after Helmet that sets `Permissions-Policy: camera=(), microphone=(), geolocation=()`
    - Ensure Helmet runs before CORS middleware
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

- [x] 5. Write integration tests
  - [x] 5.1 Create `backend/src/__tests__/cors.test.ts` with Supertest integration tests
    - Test 1: allowed origin → `Access-Control-Allow-Origin` equals that origin (Req 6.1)
    - Test 2: disallowed origin → no `Access-Control-Allow-Origin` header (Req 6.2)
    - Test 3: preflight from allowed origin → 204 + correct `Access-Control-Allow-*` headers (Req 6.3)
    - Test 4: preflight from disallowed origin → 403 (Req 6.4)
    - Test 5: no `Origin` header → request succeeds (Req 6.5)
    - Test 6: allowed origin → `Access-Control-Allow-Credentials: true` (Req 6.6)
    - Test 7: single request asserts all 7 Helmet headers present and `X-Powered-By` absent (Req 4.1–4.8)
    - _Requirements: 4.1–4.8, 6.1–6.6_

  - [x]\* 5.2 Write property test for production mode rejects http:// origins — Property 7
    - **Property 7: Production mode rejects non-HTTPS origins**
    - **Validates: Requirements 5.1, 5.2**
    - File: `backend/src/__tests__/cors.property.test.ts`
    - Tag: `Feature: cors-helmet-security-headers, Property 7`

- [x] 6. Add `.env.example` entries and inline code comments
  - [x] 6.1 Add `FRONTEND_ORIGINS` and `ADMIN_CORS_ORIGINS` entries to `.env.example` (or create it if absent)
    - Include a comment explaining comma-separated format, local dev value, and production HTTPS requirement
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 7. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Property tests live in `cors.property.test.ts` and test pure functions / config objects directly — no HTTP server needed
- Integration tests in `cors.test.ts` spin up the full NestJS app via Supertest
- `fast-check` must be installed before any property tests are run (`npm install --save-dev fast-check` in `backend/`)
- Helmet must be registered before `enableCors` so security headers appear on 403 responses too
