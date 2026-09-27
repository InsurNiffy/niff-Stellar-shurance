# Event Stream (Server-Sent Events)

`GET /v1/events/stream` is a Server-Sent Events (SSE) endpoint that pushes live
claim and transaction updates to subscribed clients. Events are filtered to what
the caller subscribed to: specific claim ids and/or the caller's own address.

## Authentication

`EventSource` cannot set request headers, so the stream does not accept the
normal `Authorization` header. Instead:

1. Call the authenticated endpoint `POST /v1/events/stream-token` with the usual
   JWT. It returns a short-lived, single-purpose stream token.
2. Open the stream with that token as a query parameter:

```
GET /v1/events/stream?token=<streamToken>&claims=<id,id>&address=<0x...>
```

The stream token is scoped to the event stream only, expires quickly, and is
validated on connect. The caller's address is derived from the token; the
`address` filter can only select the caller's own address.

## Subscriptions

| Query param | Meaning                                                        |
| ----------- | -------------------------------------------------------------- |
| `claims`    | Comma-separated claim ids to receive updates for.              |
| `address`   | The caller's own address (optional; defaults to token subject).|

Only events matching a subscription are delivered to a given connection.

## Event payload schema

Every event is a versioned JSON envelope. The SSE `event:` field is the event
`type` and the `data:` field is the JSON envelope.

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
