# Claims Event Stream (SSE)

Real-time claim updates are pushed to connected frontend clients over Server-Sent Events (SSE), reducing the need for polling.

## Endpoint

```
GET /events/claims
```

Implemented with the NestJS `@Sse` decorator. The response is a `text/event-stream`.

## Authentication

- **Wallet JWT (preferred):** send `Authorization: Bearer <wallet-jwt>`. The stream is scoped to the authenticated wallet.
- **Anonymous:** allowed, but subject to stricter rate limits (fewer concurrent connections and a lower connection-establishment rate per IP).

## Events

Events are emitted when the indexer worker upserts claim rows. The worker publishes to a Redis pub/sub channel; the SSE endpoint subscribes and fans out to connected clients.

Each message is a JSON payload describing the claim change (claim id, status, and updated fields).

## Reconnect guidance

The server advertises a reconnect delay via the SSE `retry` field in the stream. Clients should honor this value and reconnect automatically on disconnect. Use the standard `EventSource` API, which reconnects automatically using the advertised `retry` interval.

## Graceful shutdown

On shutdown the server drains active SSE connections: it stops accepting new subscribers, completes in-flight events, and closes open streams so clients reconnect cleanly.

## Limits

```ts
type EventType =
  | "claim.vote"
  | "claim.status"
  | "transaction.confirmed"
  | "transaction.failed";

interface EventEnvelope<T = unknown> {
  /** Schema version for forward-compatible consumers. */
  v: 1;
  /** Monotonic event id, also used as the SSE id for resume. */
  id: string;
  /** Event type, mirrored in the SSE `event:` field. */
  type: EventType;
  /** ISO-8601 timestamp of when the event was produced. */
  ts: string;
  /** Claim id this event relates to, when applicable. */
  claimId?: string;
  /** Address this event relates to, when applicable. */
  address?: string;
  /** Type-specific payload. */
  data: T;
}
```

Example:

```
event: claim.vote
id: 1712345678901-0
data: {"v":1,"id":"1712345678901-0","type":"claim.vote","ts":"2024-04-05T18:14:38.901Z","claimId":"42","address":"0xabc...","data":{"vote":"approve","weight":"1"}}
```

## Event field dictionary

Per `docs/NAMING_CONVENTIONS.md`, API responses and contract events use
`camelCase` while DB columns use `snake_case`. The table below is the canonical
mapping for every field carried in the event envelope and its `data` payloads,
so consumers can translate between the wire format and storage without guessing.

| Wire field (camelCase) | DB column (snake_case) | Notes                                   |
| ---------------------- | ---------------------- | --------------------------------------- |
| `v`                    | —                      | Envelope schema version, not persisted. |
| `id`                   | `event_id`             | Also the SSE `id` for resume.           |
| `type`                 | `event_type`           | Mirrored in the SSE `event:` field.     |
| `ts`                   | `created_at`           | ISO-8601 on the wire.                   |
| `claimId`              | `claim_id`             |                                         |
| `address`              | `address`              | Already single-word; unchanged.         |
| `data`                 | `payload`              | Type-specific body.                     |
| `data.vote`            | `vote`                 | `claim.vote` payload.                   |
| `data.weight`          | `weight`               | `claim.vote` payload.                   |
| `data.status`          | `status`               | `claim.status` payload.                 |
| `data.txHash`          | `tx_hash`              | `transaction.*` payload.                |
| `data.blockNumber`     | `block_number`         | `transaction.*` payload.                |

Contract event field names follow the same `camelCase` convention as the wire
format (e.g. `claimId`, `txHash`), so no translation is needed between contract
events and API responses — only between the wire format and DB columns.

## Contract event parser registry

The indexer parses raw contract events with a **parser registry** that maps a
contract id and a semver range to a concrete `EventParser`. Because contract
event schemas can change between deployments, the registry lets the indexer
parse old and new events from the same stream correctly.

```ts
interface EventParser {
  /** Semver range this parser handles, e.g. "^1.0.0". */
  range: string;
  /** Contract event name this parser handles, e.g. "claim_filed". */
  event: string;
  /** Parse a raw contract event into the normalized shape. */
  parse(raw: RawContractEvent): ParsedEvent;
}

class ParserRegistry {
  register(contractId: string, parser: EventParser): void;
  /** Resolve the parser for (contractId, event) at a given contract version. */
  resolve(contractId: string, event: string, version: string): EventParser | undefined;
}
```

### Initial schema parsers

The initial contract schema registers one parser per event:

| Event               | Semver range | Notes                                   |
| ------------------- | ------------ | --------------------------------------- |
| `claim_filed`       | `^1.0.0`     | Claim creation.                         |
| `vote_cast`         | `^1.0.0`     | Vote recorded on a claim.               |
| `policy_initiated`  | `^1.0.0`     | Policy lifecycle start.                 |
| `policy_updated`    | `^1.0.0`     | Policy parameter change.                |
| `claim_resolved`    | `^1.0.0`     | Claim resolution.                       |

### Version routing

Incoming events are routed to the correct parser using the **deployment
registry version at the event's ledger**. The indexer looks up the contract
version that was active when the event's ledger was produced, then asks the
registry to resolve `(contractId, event, version)`. This means a single mixed
stream containing events from multiple contract versions is parsed with the
parser that matches each event's own version.

### Unknown schemas

If no parser matches `(contractId, event, version)` — for example an event from
a contract version the indexer does not yet know about — the indexer does **not**
silently skip the event. Instead it emits a structured warning row containing the
contract id, event name, version, ledger, and transaction hash, and increments an
`indexer.unknown_schema` metric. Warnings are observable in logs and metrics so
operators can add a parser for the new schema.

## Vote ingestion and tally reconciliation

`VoteLogged` contract events are ingested into the `votes` table. Ingestion is
**idempotent**: the table has a unique constraint on
`(claim_id, voter_address)`, so replaying the same event (or receiving a
duplicate from the stream) does not create a second row.

Each vote insert and the corresponding tally update on `claims` happen in the
**same DB transaction**:

- `approve` votes increment `claims.approvals`.
- `reject` votes increment `claims.rejections`.

Because the insert and the tally bump commit atomically, a duplicate vote event
is a no-op for both the `votes` row and the tally columns — tallies are never
double-counted.

### Reconciliation job

A scheduled reconciliation job periodically compares the tally columns against
the source of truth (`COUNT` of `votes` rows grouped by claim and vote):

```sql
SELECT c.id,
       c.approvals,
       c.rejections,
       COUNT(v.id) FILTER (WHERE v.vote = 'approve') AS actual_approvals,
       COUNT(v.id) FILTER (WHERE v.vote = 'reject')  AS actual_rejections
FROM claims c
LEFT JOIN votes v ON v.claim_id = c.id
GROUP BY c.id, c.approvals, c.rejections
HAVING c.approvals <> COUNT(v.id) FILTER (WHERE v.vote = 'approve')
    OR c.rejections <> COUNT(v.id) FILTER (WHERE v.vote = 'reject');
```

Any claim returned by this query is a discrepancy. The job:

- Emits a structured warning per discrepant claim (claim id, stored tallies,
  actual counts) and increments a `reconciliation.discrepancy` metric.
- Records the last run timestamp and the set of discrepant claim ids so the
  status is observable.

### Reconciliation status on `GET /claims/:id`

The claim detail response includes a `reconciliation` object so clients can see
whether the claim's tallies currently agree with its vote rows:

```ts
interface ClaimReconciliationStatus {
  /** Whether stored tallies match COUNT of vote rows. */
  ok: boolean;
  /** Stored tally columns. */
  approvals: number;
  rejections: number;
  /** Counts derived from the votes table. */
  actualApprovals: number;
  actualRejections: number;
  /** ISO-8601 timestamp of the last reconciliation run, if any. */
  checkedAt?: string;
}
```

When `ok` is `false`, the claim's tallies disagree with its vote rows and the
discrepancy has been flagged by the reconciliation job.

## Delivery guarantees

- **Fan-out across instances.** Events are published to a Redis pub/sub channel
  and every backend instance relays them to its own connected clients, so a
  client connected to any instance receives events produced anywhere.
- **Connection registry.** Active connections are tracked per user with a
  per-user connection cap. Connections beyond the cap are rejected on connect.
- **Heartbeats.** A comment heartbeat (`: ping`) is sent every 15 seconds to keep
  intermediaries from closing idle connections.
- **Cleanup.** Registry entries are removed when the client disconnects or the
  connection errors.

## Resume with `Last-Event-ID`

On reconnect, browsers automatically send the last received event id in the
`Last-Event-ID` header. The server keeps a short Redis stream buffer of recent
events and replays buffered events after that id before resuming live delivery,
so clients do not miss updates across brief disconnects.

```
GET /v1/events/stream?token=<streamToken>&claims=42
Last-Event-ID: 1712345678901-0
```

If the requested id has aged out of the buffer, the server resumes from the
oldest buffered event and the client should reconcile state via the normal REST
endpoints.

## Limits

Connection counts are bounded by the documented per-wallet and per-IP limits. Load tests confirm the connection count stays within these limits.
