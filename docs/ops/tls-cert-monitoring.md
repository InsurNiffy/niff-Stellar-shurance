# TLS Certificate Expiry Monitoring

**Owner:** Platform Engineering
**Status:** Initial implementation — awaiting deployment and maintainer confirmation of ownership
**Last Updated:** 2026-08-28

---

## Overview

This document describes the TLS certificate expiry monitoring system for NiffyInsure's public-facing endpoints. The monitor:

- **Checks** each endpoint's TLS certificate expiry date via standard TLS handshake
- **Alerts** at 30 days and 7 days before expiry with per-threshold re-fire suppression
- **Discovers** endpoints from real deployment configuration (environment variables, ingress rules)
- **Documents** renewal mechanisms and responsible owners where discoverable

The monitor runs as a daily scheduled job and sends alerts via webhook to configured endpoints.

---

## Public Endpoints

### Inventory

Below are the endpoints currently discovered from repository configuration. Endpoints marked `<OWNER: TBD>` require confirmation from the team before the renewal ownership is considered complete per issue #1183.

| Endpoint | Purpose | Renewal Mechanism | Certificate Issuer | Owner | Notes |
|----------|---------|-------------------|---------------------|-------|-------|
| `${API_BASE_URL}` (e.g., `api.niffyinsur.com`) | Backend REST API + GraphQL | `<RENEWAL_MECHANISM: TBD>` | <OWNER: TBD, needs confirmation> | Public-facing API for frontend and partners; handled by reverse proxy / load balancer | |
| `${FRONTEND_ORIGINS}` (e.g., `app.niffyinsur.com`) | Frontend (Next.js) application | `<RENEWAL_MECHANISM: TBD>` | <OWNER: TBD, needs confirmation> | Public web application UI | May be CDN-fronted (Cloudflare, Vercel, CloudFront) |
| `${TENANT_BASE_DOMAIN}` subdomains (e.g., `*.niffyinsur.com`) | Multi-tenant isolation | `<RENEWAL_MECHANISM: TBD>` | <OWNER: TBD, needs confirmation> | Wildcard or per-tenant certificates | For multi-tenant deployments |
| `https://gateway.pinata.cloud/ipfs/*` | Pinata IPFS gateway (external) | Managed by Pinata | Pinata / Cloudflare | Pinata (3rd-party) | Used for evidence/claim document retrieval; no action required by NiffyInsure ops |

### Certificate Renewal Mechanisms (Discoverable from Config)

#### API Domain
**Configuration:** `API_BASE_URL` environment variable
**Current State:** Placeholder value `https://api.example.com` in example config; actual production domain requires environment override at deployment time.
**Renewal Mechanism:** <RENEWAL_MECHANISM: TBD — inspect infrastructure config>
- [ ] Check if Kubernetes `cert-manager` is deployed with automatic ACME (Let's Encrypt) renewal
- [ ] Check if CDN (Cloudflare, AWS CloudFront, Akamai) manages TLS with automatic renewal
- [ ] Check if certificates are manually managed (implies higher renewal risk; flag prominently)

**Responsible Owner:** <OWNER: TBD, needs confirmation from infrastructure team>

#### Frontend Domain
**Configuration:** `FRONTEND_ORIGINS` environment variable
**Current State:** `http://localhost:3001` in development; production domain configured at deployment time.
**Renewal Mechanism:** <RENEWAL_MECHANISM: TBD — see notes below>
- [ ] Check `next.config.js` for Vercel deployment configuration (Vercel manages TLS automatically)
- [ ] If deployed to Kubernetes, check for `cert-manager` annotations on Ingress resources
- [ ] If CDN-fronted, certificate may be managed by CDN provider (Cloudflare, Vercel, etc.)

**Responsible Owner:** <OWNER: TBD, needs confirmation from frontend/platform team>

#### Multi-Tenant Subdomains
**Configuration:** `TENANT_BASE_DOMAIN` environment variable (default: `niffyinsur.com`)
**Current State:** Not enabled in development (`TENANT_RESOLUTION_ENABLED=false`); activated only in multi-tenant deployments.
**Renewal Mechanism:** <RENEWAL_MECHANISM: TBD — discovery depends on deployment>
- [ ] If wildcard certificate (e.g., `*.niffyinsur.com`): check if automatically renewed via cert-manager or CDN
- [ ] If per-tenant certificates: check how certificate provisioning integrates with tenant onboarding

**Responsible Owner:** <OWNER: TBD, needs confirmation from product/platform team>

---

## Monitor Configuration

### Environment Variables

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `TLS_CERT_MONITOR_ENABLED` | `true\|false` | `true` | Enable/disable the TLS certificate monitor |
| `TLS_CERT_MONITOR_CRON` | Cron expression | `0 2 * * *` | Schedule (02:00 UTC daily) |
| `TLS_ENDPOINTS_CONFIG_PATH` | File path | `config/tls-endpoints.json` | JSON file listing public endpoints to monitor |
| `TLS_CERT_ALERT_WEBHOOK_URL` | URL | (unset) | Webhook endpoint for alerts (optional; falls back to logging only) |
| `TLS_CERT_ALERT_WEBHOOK_SECRET` | String | (unset) | HMAC secret for webhook signature verification |
| `TLS_CERT_EXPIRY_ALERT_DAYS_TIER_1` | Number | `30` | First alert threshold (days before expiry) |
| `TLS_CERT_EXPIRY_ALERT_DAYS_TIER_2` | Number | `7` | Second alert threshold (days before expiry) |
| `TLS_CERT_MONITOR_CONNECTION_TIMEOUT_MS` | Number | `10000` | TLS connection timeout per endpoint |
| `TLS_CERT_MONITOR_CONCURRENCY` | Number | `5` | Parallel endpoint checks (to avoid rate limiting) |

### Endpoints Configuration (JSON)

Create `config/tls-endpoints.json` with the list of public endpoints:

```json
{
  "endpoints": [
    {
      "hostname": "api.niffyinsur.com",
      "port": 443,
      "description": "Backend API"
    },
    {
      "hostname": "app.niffyinsur.com",
      "port": 443,
      "description": "Frontend application"
    }
  ]
}
```

Or pass endpoints via environment variable (overrides file):

```bash
export TLS_ENDPOINTS_JSON='[{"hostname":"api.example.com","port":443}]'
```

---

## Alert Thresholds & Re-fire Suppression

The monitor implements **two-tier alerting** to give ops teams appropriate notice:

| Tier | Threshold | Purpose | Re-fire |
|------|-----------|---------|---------|
| Tier 1 | 30 days before expiry | **Initial notice** — allows time for renewal requests, procurement, etc. | Once per certificate; suppressed until expiry crosses below 30 days again |
| Tier 2 | 7 days before expiry | **Urgent notice** — cert is expiring very soon; critical to act | Once per certificate; suppressed until expiry crosses below 7 days again |

**Re-fire Suppression Logic:**
- After Tier 1 alert fires (cert at day 30), the alert is recorded in Redis with TTL equal to time-to-expiry
- If the monitor runs again before expiry, Tier 1 does **not** re-fire (suppressed)
- When expiry passes below 7 days, Tier 1 suppression expires and Tier 2 fires
- Tier 2 suppression operates independently; both tiers can fire if thresholds are crossed on the same run

**Example Timeline:**
```
2024-01-01: Certificate expires 2024-02-15 (46 days away)
  → Monitor runs, no alert (>30 days remaining)

2024-01-20: Certificate expires 2024-02-15 (26 days away)
  → Monitor runs, TIER 1 ALERT fires → redis key `tls:alert:api.example.com:tier_1` set
  → Next runs suppress re-fire until expiry < 7 days

2024-02-10: Certificate expires 2024-02-15 (5 days away)
  → Monitor runs, TIER 2 ALERT fires → redis key `tls:alert:api.example.com:tier_2` set
  → Subsequent runs suppress both tiers until expiry
```

---

## Alert Webhook Payload

When a certificate crosses a threshold, the monitor sends a webhook POST to `TLS_CERT_ALERT_WEBHOOK_URL`:

```json
{
  "event": "tls_certificate_expiry_alert",
  "severity": "warning",
  "tier": 1,
  "hostname": "api.niffyinsur.com",
  "port": 443,
  "expiryDate": "2024-02-15T00:00:00Z",
  "daysRemaining": 25,
  "alertedAt": "2024-01-20T02:00:00Z",
  "message": "TLS certificate for api.niffyinsur.com expires in 25 days"
}
```

**Headers:**
- `Content-Type: application/json`
- `X-Webhook-Secret: <HMAC-SHA256>` (if `TLS_CERT_ALERT_WEBHOOK_SECRET` is set)

---

## Operations Runbook

### Checking Monitor Status

Fetch the latest monitor snapshot from Redis:

```bash
redis-cli GET "tls:monitor:snapshot"
```

Output includes all endpoints checked, their status, and expiry dates.

### Manual Trigger (Testing)

Call the monitor directly from a NestJS context:

```typescript
import { TlsCertificateMonitorService } from 'src/maintenance/tls-certificate-monitor.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly tlsMonitor: TlsCertificateMonitorService) {}

  @Post('tls-check')
  async triggerManual() {
    return this.tlsMonitor.runCertificateMonitor();
  }
}
```

### Silence Alerts (Temporary)

If a certificate renewal is already in progress and you want to suppress alerts temporarily:

```bash
redis-cli SET "tls:alert:suppress:api.example.com:tier_1" "true" EX 86400
```

(Suppresses Tier 1 for 24 hours; adjust TTL as needed.)

### Inspect Alert History

```bash
redis-cli KEYS "tls:alert:*"
redis-cli GET "tls:alert:api.example.com:tier_1"
```

---

## Known Limitations & Remaining Work

### Live Verification (Out of Scope for This PR)
- This session implemented the monitor code and alerting logic. **Not verified in production** — requires deployment and live confirmation that:
  - The scheduled job actually runs on schedule
  - Alerts reach the intended on-call channel
  - Re-fire suppression works correctly across restarts

### Owner Documentation (Pending Confirmation)
- All `<OWNER: TBD>` fields require input from infrastructure/product teams
- Renewal mechanisms marked `<RENEWAL_MECHANISM: TBD>` require inspection of actual deployment config (cert-manager manifests, CDN settings, etc.)
- This documentation cannot be considered complete per issue #1183 until these are filled in

### External Dependencies
- `TLS_CERT_ALERT_WEBHOOK_URL` must point to an endpoint that is actively monitored (e.g., Pagerduty, Slack, internal on-call system)
- Without webhook configuration, alerts are logged only — no notification outside the application

---

## See Also

- Issue #1183: TLS certificate expiry monitoring
- `backend/src/maintenance/tls-certificate-monitor.service.ts` — Monitor implementation
- `backend/src/common/tls/certificate-checker.service.ts` — TLS checker (low-level)
- Multi-region deployment: `docs/ops/multi-region-deployment.md`
