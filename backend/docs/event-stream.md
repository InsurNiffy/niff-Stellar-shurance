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

Connection counts are bounded by the documented per-wallet and per-IP limits. Load tests confirm the connection count stays within these limits.
