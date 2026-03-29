# Requirements Document

## Introduction

This feature automates the generation of TypeScript types and a typed API client for the frontend from the backend's OpenAPI specification. Currently, the frontend manually maintains TypeScript interfaces in `frontend/src/lib/api/policy.ts` and `frontend/src/lib/api/claim.ts` that mirror backend DTOs, creating drift risk and maintenance burden. The solution generates a typed client at build time from the canonical OpenAPI spec, enforces spec freshness in CI, and provides a single command for local regeneration.

The backend is a NestJS application using `@nestjs/swagger` v7 with a hand-written static OpenAPI spec at `backend/src/openapi/spec.ts`. The frontend is a Next.js 15 application. CI runs in `.github/workflows/ci.yml`.

## Glossary

- **Codegen**: The automated process of generating TypeScript types and client code from an OpenAPI specification.
- **Generated_Client**: The TypeScript file(s) produced by the codegen tool, placed in `frontend/src/lib/api/generated/`.
- **OpenAPI_Spec**: The OpenAPI 3.1 JSON/TypeScript specification file at `backend/src/openapi/spec.ts`, which is the single source of truth for all API shapes.
- **Spec_Exporter**: A backend script (`backend/scripts/export-spec.ts`) that writes the `openapiSpec` object to a JSON file (`backend/openapi.json`).
- **Drift_Guard**: The CI check that fails when the committed `backend/openapi.json` diverges from the spec freshly exported from source.
- **Codegen_Tool**: The `openapi-typescript` npm package used to generate TypeScript types from the OpenAPI spec.
- **Generate_Client_Command**: The `make generate-client` Makefile target (and equivalent `npm` scripts) that runs the full export + codegen pipeline locally.
- **Header_Comment**: A machine-readable comment at the top of every generated file warning that the file must not be manually edited.

---

## Requirements

### Requirement 1: Spec Export Script

**User Story:** As a backend developer, I want a script that exports the static `openapiSpec` object to a JSON file, so that downstream tooling can consume a standard OpenAPI JSON artifact.

#### Acceptance Criteria

1. THE Spec_Exporter SHALL write the contents of `openapiSpec` from `backend/src/openapi/spec.ts` to `backend/openapi.json` as valid JSON.
2. WHEN the Spec_Exporter runs successfully, THE Spec_Exporter SHALL exit with code 0.
3. IF the Spec_Exporter encounters a write error, THEN THE Spec_Exporter SHALL exit with a non-zero code and print a descriptive error message to stderr.
4. THE Spec_Exporter SHALL be invocable via `npm run export-spec` in the `backend` directory.

---

### Requirement 2: TypeScript Client Generation

**User Story:** As a frontend developer, I want TypeScript types generated from the OpenAPI spec, so that I can use correct, up-to-date request and response shapes without manually maintaining them.

#### Acceptance Criteria

1. THE Codegen_Tool SHALL generate TypeScript type definitions from `backend/openapi.json` into `frontend/src/lib/api/generated/openapi.d.ts`.
2. WHEN the OpenAPI spec contains nullable fields (e.g., `nullable: true` or `type: ["string", "null"]`), THE Codegen_Tool SHALL represent them as TypeScript union types including `null` (e.g., `string | null`).
3. WHEN the OpenAPI spec contains discriminated unions (schemas using `oneOf`, `anyOf`, or `discriminator`), THE Codegen_Tool SHALL generate TypeScript discriminated union types.
4. THE Generated_Client SHALL be invocable via `npm run generate-client` in the `frontend` directory.
5. WHEN `npm run generate-client` completes successfully, THE Generated_Client file SHALL be present at `frontend/src/lib/api/generated/openapi.d.ts`.

---

### Requirement 3: Generated File Header Warning

**User Story:** As a developer, I want generated files to carry a clear warning comment, so that no one accidentally edits them by hand and creates drift.

#### Acceptance Criteria

1. THE Generated_Client SHALL contain a Header_Comment as the first line of the file.
2. THE Header_Comment SHALL include the text `DO NOT EDIT` and state that the file is auto-generated.
3. THE Header_Comment SHALL indicate the command used to regenerate the file (e.g., `make generate-client`).

---

### Requirement 4: Frontend TypeScript Compilation

**User Story:** As a frontend developer, I want the frontend to compile against generated types without manual overrides, so that type errors surface immediately when the API contract changes.

#### Acceptance Criteria

1. WHEN `npm run typecheck` is executed in the `frontend` directory, THE Frontend SHALL compile without TypeScript errors when using types from `Generated_Client`.
2. THE Frontend SHALL import API types exclusively from `frontend/src/lib/api/generated/openapi.d.ts` for all endpoints covered by the OpenAPI_Spec.
3. WHEN the OpenAPI_Spec adds, removes, or renames a field, THE Frontend typecheck SHALL fail until the Generated_Client is regenerated and consuming code is updated.

---

### Requirement 5: Spec Drift Guard (CI)

**User Story:** As a CI engineer, I want a CI check that fails when the committed `backend/openapi.json` diverges from what the spec exporter would produce, so that backend DTO changes cannot silently break the frontend.

#### Acceptance Criteria

1. THE Drift_Guard SHALL run as a dedicated step in the `unit-tests` CI job in `.github/workflows/ci.yml`.
2. WHEN the committed `backend/openapi.json` matches the freshly exported spec, THE Drift_Guard SHALL exit with code 0.
3. WHEN the committed `backend/openapi.json` diverges from the freshly exported spec, THE Drift_Guard SHALL exit with a non-zero code and print a human-readable error message identifying the divergence.
4. THE Drift_Guard SHALL invoke `npm run export-spec` to regenerate the spec and then use `git diff --exit-code` (or equivalent) to detect divergence.

---

### Requirement 6: Frontend Codegen CI Step

**User Story:** As a CI engineer, I want the frontend CI job to run codegen and verify the committed generated types are up to date, so that stale generated files are caught before merge.

#### Acceptance Criteria

1. THE Frontend CI job SHALL include a step that copies `backend/openapi.json` to the frontend workspace and runs `npm run generate-client`.
2. WHEN the committed `frontend/src/lib/api/generated/openapi.d.ts` matches the freshly generated output, THE Frontend CI job SHALL continue without error.
3. WHEN the committed `frontend/src/lib/api/generated/openapi.d.ts` diverges from the freshly generated output, THE Frontend CI job SHALL fail with a non-zero exit code and a message instructing the developer to run `make generate-client`.
4. THE Frontend typecheck step SHALL run after the codegen step so that type errors from a stale spec are caught in the same CI run.

---

### Requirement 7: Local Generate-Client Command

**User Story:** As a new engineer, I want a single documented command to regenerate all types locally, so that I can update the frontend after any backend DTO change without reading multiple READMEs.

#### Acceptance Criteria

1. THE Generate_Client_Command SHALL be available as `make generate-client` at the repository root.
2. WHEN `make generate-client` is invoked, THE Generate_Client_Command SHALL sequentially run the Spec_Exporter and then the Codegen_Tool.
3. WHEN `make generate-client` completes successfully, THE Generate_Client_Command SHALL exit with code 0 and the updated `frontend/src/lib/api/generated/openapi.d.ts` SHALL be present.
4. IF any step of the Generate_Client_Command fails, THEN THE Generate_Client_Command SHALL exit with a non-zero code and surface the error output.
5. THE Generate_Client_Command SHALL be documented in the repository root `README.md` under a "Updating API Types" section.
