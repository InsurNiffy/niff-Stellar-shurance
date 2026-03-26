# Requirements Document

## Introduction

This feature hardens the NestJS backend's browser-facing security posture by:

1. Replacing the current wildcard-permissive CORS setup with an environment-driven allowlist that supports multiple origins per environment (local dev, staging, production).
2. Tuning Helmet's HTTP security headers for a JSON-only API server (no HTML served).
3. Ensuring credentials (cookies, Authorization headers) are never paired with a wildcard `*` origin.
4. Providing clear developer documentation so local development remains low-friction.
5. Covering preflight (OPTIONS) flows and verifying blocked vs. allowed origins with automated tests.

The backend already imports `helmet` and has a partial CORS implementation in `main.ts`. This feature formalises, corrects, and tests that implementation.

---

## Glossary

- **CORS_Service**: The NestJS bootstrap logic responsible for evaluating `Origin` headers and deciding whether to allow or deny cross-origin requests.
- **Helmet_Middleware**: The `helmet` npm package applied as Express middleware, responsible for setting HTTP security response headers.
- **Origin_Allowlist**: The parsed, validated set of URL strings derived from `FRONTEND_ORIGINS` (and `ADMIN_CORS_ORIGINS`) environment variables.
- **Preflight_Request**: An HTTP OPTIONS request sent by browsers before credentialed or non-simple cross-origin requests.
- **FRONTEND_ORIGINS**: A comma-separated environment variable listing the approved public frontend origins.
- **ADMIN_CORS_ORIGINS**: A comma-separated environment variable listing the approved admin UI origins.
- **Config_Service**: NestJS `ConfigService` used to read validated environment variables at bootstrap.
- **Env_Validator**: The Joi-based schema in `env.validation.ts` that validates environment variables on startup.
- **CSP**: Content Security Policy HTTP header.
- **HSTS**: HTTP Strict Transport Security header.

---

## Requirements

### Requirement 1: Environment-Driven Origin Allowlist Parsing

**User Story:** As a backend engineer, I want CORS origins to be driven entirely by environment variables, so that the same codebase can serve local dev, staging, and production without code changes.

#### Acceptance Criteria

1. THE Config_Service SHALL parse `FRONTEND_ORIGINS` as a comma-separated list of URL strings, trimming whitespace from each entry.
2. THE Config_Service SHALL parse `ADMIN_CORS_ORIGINS` as a comma-separated list of URL strings, trimming whitespace from each entry.
3. WHEN `FRONTEND_ORIGINS` is not set, THE Env_Validator SHALL reject application startup with a descriptive error message.
4. WHEN `NODE_ENV` is `production` and `FRONTEND_ORIGINS` contains the value `*`, THE Env_Validator SHALL reject application startup with a descriptive error message.
5. THE Env_Validator SHALL accept `FRONTEND_ORIGINS` containing `http://localhost:3001` as a valid value when `NODE_ENV` is `development`.
6. FOR ALL parsed origin values, THE Config_Service SHALL produce an array where each element is a non-empty string with no leading or trailing whitespace.

---

### Requirement 2: CORS Policy Enforcement

**User Story:** As a frontend developer, I want the API to allow requests from approved origins and reject all others, so that the application is protected from cross-site request forgery while remaining usable from legitimate frontends.

#### Acceptance Criteria

1. WHEN a request arrives with an `Origin` header matching an entry in the Origin_Allowlist, THE CORS_Service SHALL include `Access-Control-Allow-Origin` set to that exact origin in the response.
2. WHEN a request arrives with an `Origin` header not matching any entry in the Origin_Allowlist, THE CORS_Service SHALL respond with HTTP 403 and omit the `Access-Control-Allow-Origin` header.
3. WHEN a request arrives with no `Origin` header (server-to-server or same-origin), THE CORS_Service SHALL allow the request without CORS headers.
4. THE CORS_Service SHALL set `Access-Control-Allow-Credentials: true` for all allowed cross-origin responses.
5. WHEN `FRONTEND_ORIGINS` contains `*` and `Access-Control-Allow-Credentials` is `true`, THE CORS_Service SHALL NOT be configured — this combination is prohibited by Requirement 1.4.
6. THE CORS_Service SHALL include `Authorization`, `Content-Type`, and `X-Requested-With` in the `Access-Control-Allow-Headers` response header for allowed origins.
7. THE CORS_Service SHALL include `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, and `OPTIONS` in the `Access-Control-Allow-Methods` response header.

---

### Requirement 3: Preflight (OPTIONS) Request Handling

**User Story:** As a frontend developer, I want preflight OPTIONS requests to be handled correctly, so that browsers can confirm CORS permissions before sending credentialed requests.

#### Acceptance Criteria

1. WHEN a Preflight_Request is received from an allowed origin, THE CORS_Service SHALL respond with HTTP 204 and the appropriate `Access-Control-Allow-*` headers.
2. WHEN a Preflight_Request is received from a disallowed origin, THE CORS_Service SHALL respond with HTTP 403.
3. THE CORS_Service SHALL set `Access-Control-Max-Age` to `86400` seconds in Preflight_Request responses from allowed origins.

---

### Requirement 4: Helmet Security Headers for a JSON API

**User Story:** As a security engineer, I want Helmet to be configured specifically for a JSON-only API server, so that the response headers provide a strong security baseline without breaking API clients.

#### Acceptance Criteria

1. THE Helmet_Middleware SHALL set the `X-Content-Type-Options: nosniff` header on all responses.
2. THE Helmet_Middleware SHALL set the `X-Frame-Options: DENY` header on all responses.
3. THE Helmet_Middleware SHALL set the `Strict-Transport-Security` header with `max-age=31536000` and `includeSubDomains` on all responses.
4. THE Helmet_Middleware SHALL set a `Content-Security-Policy` header with `default-src 'none'` on all responses, reflecting that the API serves no HTML, scripts, or media.
5. THE Helmet_Middleware SHALL set `X-DNS-Prefetch-Control: off` on all responses.
6. THE Helmet_Middleware SHALL set `Referrer-Policy: no-referrer` on all responses.
7. THE Helmet_Middleware SHALL set `Permissions-Policy` disabling camera, microphone, and geolocation on all responses.
8. THE Helmet_Middleware SHALL NOT set `X-Powered-By` on any response.

---

### Requirement 5: Wildcard and Credentials Safety Guard

**User Story:** As a security engineer, I want the system to prevent the insecure combination of wildcard CORS origins with credentials, so that browsers cannot be tricked into sending cookies or tokens to arbitrary sites.

#### Acceptance Criteria

1. WHEN `NODE_ENV` is `production`, THE Env_Validator SHALL require `FRONTEND_ORIGINS` to contain only fully-qualified URLs (starting with `https://`).
2. WHEN `NODE_ENV` is `production` and any entry in `FRONTEND_ORIGINS` uses the `http://` scheme, THE Env_Validator SHALL reject application startup with a descriptive error message.
3. THE CORS_Service SHALL never set `Access-Control-Allow-Origin: *` while `Access-Control-Allow-Credentials: true` is also set.

---

### Requirement 6: Automated CORS Tests

**User Story:** As a developer, I want automated tests that verify allowed and blocked origins, so that regressions in CORS policy are caught before deployment.

#### Acceptance Criteria

1. THE test suite SHALL include a test that sends a request with an allowed origin and asserts the response contains `Access-Control-Allow-Origin` equal to that origin.
2. THE test suite SHALL include a test that sends a request with a disallowed origin and asserts the response does not contain `Access-Control-Allow-Origin`.
3. THE test suite SHALL include a test that sends a Preflight_Request from an allowed origin and asserts the response status is 204 with the correct `Access-Control-Allow-*` headers.
4. THE test suite SHALL include a test that sends a Preflight_Request from a disallowed origin and asserts the response status is 403.
5. THE test suite SHALL include a test that sends a request with no `Origin` header and asserts the request succeeds.
6. THE test suite SHALL include a test that verifies `Access-Control-Allow-Credentials: true` is present in responses to allowed origins.

---

### Requirement 7: Developer Experience Documentation

**User Story:** As a new developer, I want clear documentation on how to configure CORS for local development, so that I can run the full stack locally without friction.

#### Acceptance Criteria

1. THE project documentation SHALL specify the exact `FRONTEND_ORIGINS` value required for local development (e.g., `http://localhost:3001`).
2. THE project documentation SHALL describe how to add multiple origins by comma-separating values in `FRONTEND_ORIGINS`.
3. THE project documentation SHALL state that `NODE_ENV=production` enforces HTTPS-only origins and prohibits wildcards.
4. THE project documentation SHALL include an example `.env.example` entry for `FRONTEND_ORIGINS` with a comment explaining its purpose.
5. WHERE mobile app origins are required in future, THE project documentation SHALL describe the process for adding non-browser origins to the allowlist.
