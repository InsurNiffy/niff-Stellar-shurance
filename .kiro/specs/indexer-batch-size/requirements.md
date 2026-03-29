# Requirements Document

## Introduction

The indexer currently uses a hardcoded `BATCH_SIZE = 50` when fetching ledger events from the Soroban RPC. During catch-up (large lag), this fixed window can cause RPC timeouts; during normal operation it may generate excessive RPC calls. This feature makes the batch size configurable via an environment variable (`INDEXER_BATCH_SIZE`), validated at startup, applied dynamically on each job cycle, and observable via a Prometheus metric for average batch processing time. An operator runbook section documents tuning guidance.

## Glossary

- **IndexerService**: The NestJS service (`IndexerService`) responsible for fetching and processing ledger events from the Soroban RPC.
- **IndexerWorker**: The NestJS service (`IndexerWorker`) that drives the periodic indexer loop.
- **Batch**: A single call to `soroban.getEvents()` that fetches up to `INDEXER_BATCH_SIZE` ledger events.
- **Batch_Size**: The maximum number of ledger events fetched per RPC call, controlled by `INDEXER_BATCH_SIZE`.
- **ConfigService**: The NestJS `ConfigService` used to read validated environment variables at runtime.
- **MetricsService**: The NestJS service (`MetricsService`) that registers and exposes Prometheus metrics.
- **Env_Validator**: The Joi validation schema in `backend/src/config/env.validation.ts`.
- **Job_Cycle**: One execution of the indexer loop — from reading the cursor to advancing it after processing a batch.
- **Indexer_Lag**: The difference in ledger numbers between the chain head and the last processed ledger.
- **RPC_Rate_Limit**: The request-per-second ceiling imposed by the Soroban RPC provider.

## Requirements

### Requirement 1: Environment Variable Declaration and Validation

**User Story:** As an operator, I want `INDEXER_BATCH_SIZE` validated at startup, so that misconfigured values are caught before the indexer runs.

#### Acceptance Criteria

1. THE Env_Validator SHALL accept `INDEXER_BATCH_SIZE` as an optional integer environment variable with a default value of `10`.
2. THE Env_Validator SHALL reject values of `INDEXER_BATCH_SIZE` less than `1` with a descriptive validation error at application startup.
3. THE Env_Validator SHALL reject values of `INDEXER_BATCH_SIZE` greater than `100` with a descriptive validation error at application startup.
4. THE Env_Validator SHALL reject non-integer values of `INDEXER_BATCH_SIZE` with a descriptive validation error at application startup.
5. WHEN `INDEXER_BATCH_SIZE` is absent from the environment, THE Env_Validator SHALL apply the default value of `10`.

---

### Requirement 2: Batch Size Applied to Ledger Fetch Loop

**User Story:** As an operator, I want the indexer to use the configured batch size when fetching events, so that I can tune RPC call frequency and payload size without redeploying.

#### Acceptance Criteria

1. WHEN `IndexerService` initialises, THE IndexerService SHALL read `INDEXER_BATCH_SIZE` from `ConfigService` and store it as the effective Batch_Size.
2. WHEN `IndexerService.processNextBatchForNetwork` is called, THE IndexerService SHALL pass the effective Batch_Size to `soroban.getEvents()`.
3. THE IndexerService SHALL remove the hardcoded `private readonly BATCH_SIZE = 50` field.
4. WHEN `INDEXER_BATCH_SIZE` is set to a valid value, THE IndexerService SHALL use that value on the next Job_Cycle without requiring a process restart.

---

### Requirement 3: Batch Processing Time Metric

**User Story:** As an operator, I want a Prometheus metric for batch processing time, so that I can observe the impact of different batch sizes and make informed tuning decisions.

#### Acceptance Criteria

1. THE MetricsService SHALL register a Prometheus Histogram named `indexer_batch_processing_duration_seconds` with label `network`.
2. WHEN a batch completes successfully, THE IndexerService SHALL record the elapsed wall-clock time of that batch in the `indexer_batch_processing_duration_seconds` histogram.
3. WHEN a batch results in zero processed events, THE IndexerService SHALL still record the elapsed time in the `indexer_batch_processing_duration_seconds` histogram.
4. THE MetricsService SHALL expose `indexer_batch_processing_duration_seconds` via the existing `/metrics` Prometheus scrape endpoint.
5. WHEN the Prometheus scrape endpoint is queried, THE MetricsService SHALL include `indexer_batch_processing_duration_seconds` in the response body.

---

### Requirement 4: Batch Size Boundary Tests

**User Story:** As a developer, I want automated tests that verify batch size boundaries are respected, so that regressions are caught in CI.

#### Acceptance Criteria

1. WHEN `INDEXER_BATCH_SIZE` is set to `1`, THE IndexerService SHALL pass `1` to `soroban.getEvents()`.
2. WHEN `INDEXER_BATCH_SIZE` is set to `100`, THE IndexerService SHALL pass `100` to `soroban.getEvents()`.
3. WHEN `INDEXER_BATCH_SIZE` is set to `10` (the default), THE IndexerService SHALL pass `10` to `soroban.getEvents()`.
4. WHEN `INDEXER_BATCH_SIZE` is set to `0` in the Env_Validator schema, THE Env_Validator SHALL produce a validation error.
5. WHEN `INDEXER_BATCH_SIZE` is set to `101` in the Env_Validator schema, THE Env_Validator SHALL produce a validation error.

---

### Requirement 5: Dynamic Reconfiguration Without Restart

**User Story:** As an operator, I want batch size changes to take effect on the next job cycle, so that I can tune the indexer without downtime.

#### Acceptance Criteria

1. WHEN `INDEXER_BATCH_SIZE` is updated in the environment and the process is not restarted, THE IndexerService SHALL apply the updated value on the next Job_Cycle where `ConfigService` reflects the change.
2. WHILE the indexer loop is running, THE IndexerService SHALL read Batch_Size from `ConfigService` on each call to `processNextBatchForNetwork` rather than caching it as a constructor-time constant.

---

### Requirement 6: Runbook Documentation

**User Story:** As an operator, I want a runbook section that explains how to tune `INDEXER_BATCH_SIZE` based on observed metrics, so that I can resolve indexer lag or RPC rate-limit issues without guessing.

#### Acceptance Criteria

1. THE Runbook SHALL document the valid range (`1`–`100`) and default value (`10`) of `INDEXER_BATCH_SIZE`.
2. THE Runbook SHALL describe the relationship between Batch_Size and Indexer_Lag: larger batches reduce lag faster but increase per-call RPC cost.
3. THE Runbook SHALL describe the relationship between Batch_Size and RPC_Rate_Limit: larger batches consume more quota per call and may trigger throttling.
4. THE Runbook SHALL include a decision tree that guides operators to increase Batch_Size when Indexer_Lag is high and decrease Batch_Size when RPC errors or timeouts are observed.
5. THE Runbook SHALL reference the `indexer_batch_processing_duration_seconds` metric as the primary signal for evaluating tuning decisions.
