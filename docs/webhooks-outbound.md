# Outbound Webhooks (#1484)

Partners (tenants, integrators) subscribe to platform events and receive signed
`POST` requests with retries, an idempotency key and a delivery log.

## Subscriptions

CRUD endpoints (authenticated, tenant scoped):

| Method | Path                       | Description                  |
| ------ | -------------------------- | ---------------------------- |
| POST   | `/api/v1/webhooks/subscriptions` | Create (URL, events, secret) |
| GET    | `/api/v1/webhooks/subscriptions` | List                         |
| GET    | `/api/v1/webhooks/subscriptions/:id` | Fetch one               |
| PATCH  | `/api/v1/webhooks/subscriptions/:id` | Update URL/events/active |
| DELETE | `/api/v1/webhooks/subscriptions/:id` | Delete                   |

Supported events: `policy.created`, `claim.filed`, `claim.finalized`,
`claim.paid`, `vote.cast`, `treasury.balance_low`.

A `secret` is auto-generated (32 random bytes, hex) when omitted. Rotate it by
patching the subscription with a new secret.

## Signature — `X-Niffy-Signature`

Every delivery carries:

```
X-Niffy-Signature: t=<unix-seconds>,v1=<hex-hmac-sha256>
```

- `v1` is the hex HMAC-SHA256 of `` `${t}.${rawBody}` `` keyed with the
  subscription secret. The timestamp is part of the signed content, so a
  captured signature cannot be replayed with a fresh `t`.
- Additional `v1=` entries may appear during secret rotation — accept if **any**
  matches a secret you know.
- The raw request body (exactly as received) is the signed content — verify
  before parsing JSON.

### Verification example

```js
const crypto = require('node:crypto');

function verify(rawBody, header, secret, toleranceSeconds = 300) {
  const parts = Object.fromEntries(
    header.split(',').map((p) => p.split('=')) // t=…, v1=…
  );
  const t = Number(parts.t);
  if (!Number.isFinite(t)) return false;

  // Replay protection: reject timestamps outside the ±5 minute window.
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > toleranceSeconds) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${t}.${rawBody}`)
    .digest('hex');

  const a = Buffer.from(parts.v1, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

> **Recommended replay tolerance: 5 minutes (300 seconds).** Reject anything
> older or newer. Also enforce your own idempotency via `X-Idempotency-Key`.

Other headers sent with each delivery: `X-Event-Type`, `X-Idempotency-Key`,
`X-Niffy-Timestamp`.

## Retries & delivery log

- Exponential backoff from 1 s: **1s → 2s → 4s → 8s** (base
  `MAX_OUTBOUND_WEBHOOK_ATTEMPTS`, default 5 attempts, delay capped at 32 s).
- Non-2xx responses and transport errors are retried; the attempt is recorded in
  the `webhook_deliveries` table with the response code, success flag and error
  message — query it via `WebhookDeliveryService.deliveryLog(url)`.

## SSRF validation

Target URLs are validated on create **and** update:

- HTTPS only — `http:`, `file:`, `ftp:` … are rejected.
- Embedded credentials (`user:pass@`) are rejected.
- Private, loopback, link-local, CGNAT, multicast and documentation ranges are
  blocked for IPv4 **and** IPv6 (including `::ffff:` mapped addresses).
- Hostnames such as `localhost` / `*.local` are blocked, and **every hostname
  is re-checked after DNS resolution** so a public name cannot rebind to an
  internal address.
