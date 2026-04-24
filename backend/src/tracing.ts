/**
 * OpenTelemetry instrumentation bootstrap.
 *
 * This file MUST be imported before any other module (i.e. at the very top of
 * main.ts) so that auto-instrumentation patches are applied before the
 * libraries they instrument are loaded.
 *
 * Configuration via environment variables:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  — OTLP gRPC/HTTP endpoint (e.g. http://localhost:4318)
 *                                   Defaults to no-op (no export) when unset.
 *   OTEL_SERVICE_NAME             — Service name reported in traces (default: niffyinsure-backend)
 *   OTEL_SAMPLING_RATIO           — Head-sampling ratio 0.0–1.0 (default: 1.0 in dev, 0.1 in prod)
 *
 * Sensitive data policy:
 *   - XDR payloads and private keys MUST NOT appear as span attributes.
 *   - Request bodies are never captured by auto-instrumentation (HTTP body capture is disabled).
 */

import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { Resource } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'
import { TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? 'niffyinsure-backend'
const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT

// Sampling: configurable without redeployment via env var.
// Default: 1.0 (sample everything) unless NODE_ENV=production, then 0.1.
const defaultRatio = process.env.NODE_ENV === 'production' ? 0.1 : 1.0
const samplingRatio = parseFloat(process.env.OTEL_SAMPLING_RATIO ?? String(defaultRatio))

// Only configure an exporter when an endpoint is explicitly set.
// In development (no endpoint), the SDK runs with a no-op exporter.
const traceExporter = OTLP_ENDPOINT
  ? new OTLPTraceExporter({ url: `${OTLP_ENDPOINT}/v1/traces` })
  : undefined

const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '0.0.0',
  }),
  sampler: new TraceIdRatioBasedSampler(samplingRatio),
  ...(traceExporter ? { traceExporter } : {}),
  instrumentations: [
    getNodeAutoInstrumentations({
      // HTTP instrumentation — captures incoming/outgoing HTTP spans.
      // Body capture is disabled to prevent XDR/key leakage.
      '@opentelemetry/instrumentation-http': {
        enabled: true,
        // Do not capture request/response bodies
        requestHook: () => undefined,
        responseHook: () => undefined,
      },
      // Prisma / pg instrumentation for DB spans
      '@opentelemetry/instrumentation-pg': { enabled: true },
      // Redis instrumentation for cache spans
      '@opentelemetry/instrumentation-ioredis': { enabled: true },
      // Disable noisy fs instrumentation
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
})

sdk.start()

// Graceful shutdown
process.on('SIGTERM', () => {
  sdk.shutdown().catch((err) => console.error('OTel shutdown error', err))
})

export { sdk }
