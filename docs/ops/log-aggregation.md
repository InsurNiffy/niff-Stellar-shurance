# Log Aggregation Setup

**Owner:** Platform Engineering  
**Review cadence:** Quarterly; after any change to Winston configuration or Loki deployment  
**Scope:** Backend (Winston JSON) and frontend (browser error shipping)

---

## Overview

NiffyInsure ships structured logs from two sources to a centralised aggregation system:

| Source | Format | Transport | Destination |
|---|---|---|---|
| Backend (NestJS/Winston) | JSON (newline-delimited) | HTTP push to Loki push API | Loki / Grafana |
| Frontend (browser) | JSON batch via `sendBeacon` or `fetch` | POST `/api/v1/logs/browser` | Backend → Loki |

The reference aggregation stack is **Grafana Loki** with **Grafana** as the query UI. The implementation is compatible with any Loki-compatible endpoint (e.g. Grafana Cloud, self-hosted Loki, or any system that accepts Loki's push API format).

---

## Backend log shipping

### How it works

`AppLoggerService` (`backend/src/common/logger/app-logger.service.ts`) wraps Winston and writes structured JSON logs to:

1. **Console** (always active) — line-delimited JSON, consumed by the container runtime and forwarded to the host logging driver.
2. **Loki HTTP transport** (active when `LOG_SHIPPING_URL` is set) — logs are batched in memory and pushed to the Loki push API at the configured interval or when the batch size threshold is reached.

The Loki transport (`backend/src/common/logger/loki.transport.ts`) is built on Node.js built-in `http`/`https` modules — no additional npm packages are required.

### Log field dictionary

| Field | Type | Description |
|---|---|---|
| `timestamp` | ISO 8601 | UTC timestamp |
| `level` | string | `error` / `warn` / `info` / `debug` |
| `message` | string | Human-readable summary |
| `service` | string | Always `niffyinsure-api` |
| `env` | string | `NODE_ENV` value |
| `requestId` | string | Correlation ID (`x-request-id` or generated) |
| `correlation_id` | string | Request correlation ID, bound by `RequestContextMiddleware` and added to **every** log line emitted while handling a request |
| `method` | string | HTTP verb |
| `url` | string | Request path (no query string) |
| `statusCode` | number | HTTP response status |
| `durationMs` | number | Request duration |
| `context` | string | NestJS class/module name |
| `stack` | string | Error stack trace (`error` level only) |

Fields intentionally **omitted**: `Authorization`, `Cookie`, request/response bodies, private keys, IPFS payloads.

### Loki stream labels

Every log entry shipped to Loki carries these stream labels:

```
{service="niffyinsure-api", env="production"}
```

Labels are deliberately minimal to keep Loki cardinality low. Use log-line JSON fields for fine-grained filtering in LogQL.

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `LOG_SHIPPING_URL` | optional | `""` | Loki push endpoint, e.g. `http://loki:3100/loki/api/v1/push`. Leave empty to disable remote shipping. |
| `LOG_SHIPPING_AUTH_TOKEN` | optional | `""` | Bearer token for authenticated Loki endpoints. Store in secrets manager. |
| `LOG_SHIPPING_FLUSH_INTERVAL_MS` | optional | `5000` | Milliseconds between buffer flushes. |
| `LOG_SHIPPING_BATCH_SIZE` | optional | `100` | Entries before an early flush is forced. |
| `LOG_RETENTION_DAYS` | optional | `30` | Intended retention period (informational label — enforce in Loki config). |
| `LOG_LEVEL` | required | `info` | Minimum log level for Winston. |

### Enabling in `.env`

```bash
# Backend log shipping — add to backend/.env.local or secrets manager
LOG_SHIPPING_URL=http://loki:3100/loki/api/v1/push
LOG_SHIPPING_AUTH_TOKEN=           # leave empty for unauthenticated local Loki
LOG_SHIPPING_FLUSH_INTERVAL_MS=5000
LOG_SHIPPING_BATCH_SIZE=100
LOG_RETENTION_DAYS=30
```

---

## Frontend browser error shipping

### How it works

`frontend/src/lib/log-shipper.ts` registers global `error` and `unhandledrejection` listeners. Captured events are:

1. Sanitised (Stellar addresses, secret keys, and Bearer tokens are redacted).
2. Buffered in memory.
3. Flushed every 10 seconds (configurable) or when 20 entries accumulate, using `navigator.sendBeacon` where available, falling back to `fetch` with `keepalive: true`.

The flush target is the backend endpoint `POST /api/v1/logs/browser`, which forwards entries to the Loki stream labelled `service="niffyinsure-frontend"`.

### Initialisation

Call `initBrowserLogShipper()` once in the root layout (server components are skipped automatically because `typeof window === 'undefined'` guards are in place):

```tsx
// frontend/src/app/[locale]/layout.tsx (or root layout.tsx)
'use client'
import { useEffect } from 'react'
import { initBrowserLogShipper } from '@/lib/log-shipper'

export function BrowserLogInit() {
  useEffect(() => {
    initBrowserLogShipper()
  }, [])
  return null
}
```

### Manual capture

For errors that are caught and handled (not bubbled to the global handler):

```ts
import { captureLogEntry } from '@/lib/log-shipper'

try {
  await riskyOperation()
} catch (err) {
  captureLogEntry('error', 'riskyOperation failed', err instanceof Error ? err : undefined)
}
```

### Browser log entry schema

| Field | Type | Description |
|---|---|---|
| `level` | `"error"` \| `"warn"` | Severity |
| `message` | string | Error message (truncated at 500 chars) |
| `stack` | string? | Stack trace (truncated at 2 000 chars) |
| `url` | string | `window.location.pathname` (sanitised) |
| `line` | number? | Source line (from `ErrorEvent`) |
| `col` | number? | Source column |
| `userAgent` | string | `navigator.userAgent` |
| `timestamp` | ISO 8601 | Client-side timestamp |

---

## Shipper configuration examples

The backend always writes one JSON object per line to stdout (Winston `format.json()`), so any
stdout-based shipper can collect logs without the in-process `LOG_SHIPPING_URL` transport.

### Loki (Promtail)

```yaml
# promtail-config.yml
server:
  http_listen_port: 9080
positions:
  filename: /tmp/positions.yaml
clients:
  - url: http://loki:3100/loki/api/v1/push
scrape_configs:
  - job_name: niffyinsure-api
    docker_sd_configs:
      - host: unix:///var/run/docker.sock
    relabel_configs:
      - source_labels: ['__meta_docker_container_name']
        regex: '/.*backend.*'
        action: keep
    pipeline_stages:
      - json:
          expressions:
            level: level
            service: service
            correlation_id: correlation_id
      - labels:
          level:
          service:
      # correlation_id is high-cardinality: keep it in the line, not as a label
```

### ELK (Filebeat → Elasticsearch)

```yaml
# filebeat.yml
filebeat.autodiscover:
  providers:
    - type: docker
      templates:
        - condition:
            contains:
              docker.container.name: backend
          config:
            - type: container
              paths:
                - /var/lib/docker/containers/${data.docker.container.id}/*.log
              processors:
                - decode_json_fields:
                    fields: ['message']
                    target: ''
                    overwrite_keys: true
output.elasticsearch:
  hosts: ['http://elasticsearch:9200']
  index: 'niffyinsure-api-%{+yyyy.MM.dd}'
setup.template.name: 'niffyinsure-api'
setup.template.pattern: 'niffyinsure-api-*'
```

Search a single request in Kibana with `correlation_id:"<x-request-id>"`.

---

## Loki deployment (reference)

### Docker Compose (local / staging)

Add Loki and Grafana to your `docker-compose.yml`:

```yaml
services:
  loki:
    image: grafana/loki:3.0.0
    ports:
      - "3100:3100"
    command: -config.file=/etc/loki/local-config.yaml
    volumes:
      - loki-data:/loki

  grafana:
    image: grafana/grafana:11.0.0
    ports:
      - "3200:3000"
    environment:
      - GF_AUTH_ANONYMOUS_ENABLED=true
      - GF_AUTH_ANONYMOUS_ORG_ROLE=Admin
    volumes:
      - grafana-data:/var/lib/grafana
    depends_on:
      - loki

volumes:
  loki-data:
  grafana-data:
```

Configure the Loki data source in Grafana at `http://loki:3100`.

### Loki retention policy

Set the global retention period in the Loki configuration file (`loki-config.yaml`):

```yaml
compactor:
  working_directory: /loki/compactor
  shared_store: filesystem
  retention_enabled: true

limits_config:
  retention_period: 720h   # 30 days — match LOG_RETENTION_DAYS
```

> Actual data deletion is enforced by the Loki compactor, not by the application. `LOG_RETENTION_DAYS` is an informational label only.

### Production (Grafana Cloud)

Set `LOG_SHIPPING_URL` to your Grafana Cloud Loki push URL:

```
https://logs-prod-<region>.grafana.net/loki/api/v1/push
```

Set `LOG_SHIPPING_AUTH_TOKEN` to a Grafana Cloud API token scoped to **Logs Writer** only. Store in AWS Secrets Manager / GitHub Actions secrets.

---

## LogQL query examples

```logql
# All errors from the backend in the last hour
{service="niffyinsure-api"} | json | level="error"

# Slow requests (> 1 000 ms)
{service="niffyinsure-api"} | json | durationMs > 1000

# Browser errors for a specific segment
{service="niffyinsure-frontend"} | json | segment="claims"

# Rate of errors per minute
rate({service="niffyinsure-api"} | json | level="error" [1m])

# Every log line for a single request
{service="niffyinsure-api"} | json | correlation_id="<x-request-id>"
```

---

## Alerting (Grafana alert rules)

Create alert rules in Grafana that trigger when:

| Condition | LogQL expression | Severity |
|---|---|---|
| Error rate > 10/min | `rate({service="niffyinsure-api"} \| json \| level="error" [1m]) > 0.17` | Critical |
| No logs for 5 min | `absent_over_time({service="niffyinsure-api"}[5m])` | Warning |
| Browser error spike | `rate({service="niffyinsure-frontend"} \| json \| level="error" [5m]) > 1` | Warning |

Route alerts to the existing `OPS_ALERT_WEBHOOK_URL` endpoint (Slack / PagerDuty).

---

## Privacy and security notes

- Logs never contain: wallet private keys, seed phrases, JWT secrets, raw XDR, request bodies, `Authorization` / `Cookie` headers.
- IP addresses are hashed when `IP_HASH_SALT` is set (handled by `AppLoggerService`).
- Browser log shipper strips Stellar public addresses, secret keys, and Bearer tokens before shipping.
- `LOG_SHIPPING_AUTH_TOKEN` must be stored in the secrets manager, never in source control.
- The Loki endpoint must use TLS in production (`https://`).
- Grant the service account only write access to Loki (`logs:write`) — never admin access.

---

## Operational checklist

- [ ] `LOG_SHIPPING_URL` set in staging and production environments
- [ ] `LOG_SHIPPING_AUTH_TOKEN` stored in secrets manager
- [ ] Loki push endpoint accessible from backend pods (firewall / VPC rules)
- [ ] Grafana data source configured and `Test connection` passes
- [ ] Retention period configured in Loki compactor (`retention_enabled: true`)
- [ ] Grafana alert rules for error rate and log absence created
- [ ] Alert routes point to `OPS_ALERT_WEBHOOK_URL`
- [ ] `initBrowserLogShipper()` wired into the root layout
- [ ] Privacy review: confirm no PII reaches Loki in staging log sample
