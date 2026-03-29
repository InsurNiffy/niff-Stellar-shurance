# Design Document: Indexer Batch Size

## Overview

This feature replaces the hardcoded `BATCH_SIZE = 50` in `IndexerService` with a value read from `ConfigService` on every job cycle. The batch size is validated at startup via the existing Joi schema, exposed as a Prometheus histogram for observability, and documented in an operator runbook.

The change is intentionally minimal: no new modules, no new database tables, no new API endpoints. The three touch-points are `env.validation.ts`, `IndexerService`, and `MetricsService`.

## Architecture

```mermaid
flowchart TD
    ENV[".env / process.env\nINDEXER_BATCH_SIZE"] -->|Joi validation at startup| CFG[ConfigService]
    CFG -->|get() per cycle| IS[IndexerService\nprocessNextBatchForNetwork]
    IS -->|batchSize param| SRB[SorobanService\ngetEvents]
    IS -->|observe duration| MS[MetricsService\nindexer_batch_processing_duration_seconds]
    MS -->|/metrics| PROM[Prometheus scrape]
```

Key design decision: the batch size is read via `this.config.get()` inside `processNextBatchForNetwork` on every call rather than cached in the constructor. This satisfies Requirement 5 (dynamic reconfiguration) without any additional infrastructure — NestJS `ConfigService` already reads from the validated environment object, so a process restart is the only mechanism that changes the value in practice, but the code is structured to pick up any future hot-reload mechanism automatically.

## Components and Interfaces

### env.validation.ts — new field

```typescript
INDEXER_BATCH_SIZE: Joi.number()
  .integer()
  .min(1)
  .max(100)
  .default(10)
  .description('Max ledger events fetched per Soroban RPC call (1–100, default 10)'),
```

### IndexerService — changes

- Remove `private readonly BATCH_SIZE = 50`
- In `processNextBatchForNetwork`, read batch size inline:
  ```typescript
  const batchSize = this.config.get<number>('INDEXER_BATCH_SIZE', 10);
  ```
- Wrap the `soroban.getEvents(startLedger, batchSize)` call with a timer and record to `MetricsService`.

### MetricsService — new metric

New field added in the constructor, following the existing pattern:

```typescript
readonly indexerBatchDuration: client.Histogram<string>;
```

Registered as:

```typescript
this.indexerBatchDuration = new client.Histogram({
  name: 'indexer_batch_processing_duration_seconds',
  help: 'Wall-clock time to fetch and process one indexer batch',
  labelNames: ['network'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [this.registry],
});
```

A helper method `recordIndexerBatch` is added to keep call-sites clean:

```typescript
recordIndexerBatch(network: string, durationMs: number): void {
  this.indexerBatchDuration.observe({ network }, durationMs / 1000);
}
```

### IndexerModule — no change required

`MetricsModule` is already imported globally (via `AppModule`), so `MetricsService` is injectable into `IndexerService` without touching `indexer.module.ts`. If it is not globally exported, add `MetricsModule` to the `imports` array.

## Data Models

No schema changes. The feature is entirely in-process configuration and metrics.

The only "data" involved is the validated environment value:

| Variable | Type | Min | Max | Default | Source |
|---|---|---|---|---|---|
| `INDEXER_BATCH_SIZE` | integer | 1 | 100 | 10 | `env.validation.ts` Joi schema |

## Error Handling

| Scenario | Behaviour |
|---|---|
| `INDEXER_BATCH_SIZE` absent | Joi applies default `10`; startup proceeds normally |
| `INDEXER_BATCH_SIZE = 0` | Joi rejects at startup with `"INDEXER_BATCH_SIZE" must be greater than or equal to 1` |
| `INDEXER_BATCH_SIZE = 101` | Joi rejects at startup with `"INDEXER_BATCH_SIZE" must be less than or equal to 100` |
| `INDEXER_BATCH_SIZE = "abc"` | Joi rejects at startup with `"INDEXER_BATCH_SIZE" must be a number` |
| `config.get()` returns `undefined` at runtime | Fallback default `10` passed as second arg to `config.get<number>('INDEXER_BATCH_SIZE', 10)` |
| Metric observe throws | Wrapped in try/catch; error is logged but does not interrupt the indexer loop |

Startup validation is the primary guard. Runtime fallback is a belt-and-suspenders safety net.


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Valid batch sizes are accepted by the schema

*For any* integer `n` in the range `[1, 100]`, validating `{ INDEXER_BATCH_SIZE: n }` against the Joi schema should succeed and return `n` as the resolved value.

**Validates: Requirements 1.1**

---

### Property 2: Out-of-range integers are rejected by the schema

*For any* integer `n` where `n < 1` or `n > 100`, validating `{ INDEXER_BATCH_SIZE: n }` against the Joi schema should produce a validation error. This covers both the lower boundary (0, negatives) and the upper boundary (101+).

**Validates: Requirements 1.2, 1.3, 4.4, 4.5**

---

### Property 3: Non-integer values are rejected by the schema

*For any* non-integer value (float, string, boolean) supplied as `INDEXER_BATCH_SIZE`, the Joi schema should produce a validation error.

**Validates: Requirements 1.4**

---

### Property 4: Batch size is forwarded to soroban.getEvents on every cycle

*For any* valid batch size `n` returned by `ConfigService.get('INDEXER_BATCH_SIZE')`, a call to `processNextBatchForNetwork` should invoke `soroban.getEvents` with exactly `n` as the limit argument. This holds for boundary values (1, 100) and the default (10).

**Validates: Requirements 2.2, 4.1, 4.2, 4.3**

---

### Property 5: Batch size is re-read from ConfigService on each cycle (dynamic reconfiguration)

*For any* two consecutive calls to `processNextBatchForNetwork` where `ConfigService.get` returns different values `n1` and `n2`, the first call should invoke `soroban.getEvents` with `n1` and the second with `n2`. The service must not cache the value between cycles.

**Validates: Requirements 2.4, 5.1, 5.2**

---

### Property 6: Batch processing duration is recorded for every batch

*For any* call to `processNextBatchForNetwork` — whether it processes events or returns zero — `MetricsService.recordIndexerBatch` should be called exactly once with the correct `network` label and a non-negative duration in milliseconds.

**Validates: Requirements 3.2, 3.3**

---

## Testing Strategy

### Dual Testing Approach

Both unit tests and property-based tests are required. They are complementary:

- Unit tests cover specific examples, integration wiring, and edge cases.
- Property tests verify universal invariants across randomised inputs.

### Unit Tests (specific examples and wiring)

- `env.validation.ts`: assert default value `10` when `INDEXER_BATCH_SIZE` is absent (Req 1.5).
- `MetricsService`: assert `indexer_batch_processing_duration_seconds` is present in the Prometheus registry with label `network` after module init (Req 3.1, 3.4, 3.5).
- `IndexerService` constructor: assert `ConfigService.get` is called during init (Req 2.1).

### Property-Based Tests

Library: **`fast-check`** (already a common choice in TypeScript/NestJS projects; add as a dev dependency if not present).

Each property test runs a minimum of **100 iterations**.

| Test | Arbitrary | Assertion | Design Property |
|---|---|---|---|
| Valid range accepted | `fc.integer({ min: 1, max: 100 })` | Schema returns value, no error | Property 1 |
| Out-of-range rejected | `fc.oneof(fc.integer({ max: 0 }), fc.integer({ min: 101 }))` | Schema throws validation error | Property 2 |
| Non-integer rejected | `fc.oneof(fc.float(), fc.string(), fc.boolean())` | Schema throws validation error | Property 3 |
| Batch size forwarded | `fc.integer({ min: 1, max: 100 })` | `soroban.getEvents` called with that exact value | Property 4 |
| Dynamic reconfiguration | `fc.tuple(fc.integer({min:1,max:100}), fc.integer({min:1,max:100}))` | Each cycle uses the value returned by ConfigService at that call | Property 5 |
| Duration always recorded | `fc.record({ network: fc.string(), events: fc.array(fc.anything()) })` | `recordIndexerBatch` called once per `processNextBatchForNetwork` invocation | Property 6 |

Tag format for each test:
```
// Feature: indexer-batch-size, Property <N>: <property_text>
```

### Test File Locations

- `backend/src/__tests__/indexer-batch-size.property.test.ts` — all property-based tests
- `backend/src/__tests__/indexer-batch-size.test.ts` — unit/example tests
