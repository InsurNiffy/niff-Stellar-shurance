/**
 * Browser-side structured error log shipper.
 *
 * Captures unhandled errors and promise rejections and ships them in batches
 * to the backend /api/v1/logs/browser endpoint (or a configurable URL).
 * The backend forwards these to the centralised log aggregation system.
 *
 * Privacy policy:
 *   - Stack traces are truncated to 2 000 characters.
 *   - Wallet addresses, private keys, and seeds are stripped before shipping.
 *   - User agents and URLs are included for debugging but no persistent user IDs.
 *   - No request/response bodies are captured.
 *
 * Usage:
 *   Call `initBrowserLogShipper()` once at application bootstrap (e.g. in the
 *   root layout) to register the global error handlers.
 */

import { getConsent } from '@/lib/cookie-consent';

const STELLAR_ADDRESS_RE = /\bG[A-Z0-9]{54,56}\b/g;
const SECRET_KEY_RE = /\bS[A-Z0-9]{54,56}\b/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const MAX_STACK_LENGTH = 2000;
const DEFAULT_FLUSH_INTERVAL_MS = 10_000;
const DEFAULT_BATCH_SIZE = 20;

export interface BrowserLogEntry {
  level: 'error' | 'warn';
  message: string;
  stack?: string;
  url: string;
  line?: number;
  col?: number;
  userAgent: string;
  timestamp: string;
}

function sanitize(text: string): string {
  return text
    .replace(STELLAR_ADDRESS_RE, '[REDACTED_ADDRESS]')
    .replace(SECRET_KEY_RE, '[REDACTED_SECRET]')
    .replace(BEARER_RE, 'Bearer [REDACTED]');
}

function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : `${text.slice(0, maxLen)}…`;
}

class BrowserLogShipper {
  private buffer: BrowserLogEntry[] = [];
  private timer: number | undefined;
  private readonly endpoint: string;
  private readonly batchSize: number;

  constructor(endpoint: string, flushIntervalMs: number, batchSize: number) {
    this.endpoint = endpoint;
    this.batchSize = batchSize;
    this.timer = window.setInterval(() => this.flush(), flushIntervalMs);
  }

  capture(entry: Omit<BrowserLogEntry, 'timestamp' | 'url' | 'userAgent'>): void {
    if (typeof window === 'undefined') return;
    // Block log shipping until the user has granted analytics consent
    if (getConsent() !== 'accepted') return;
    const safeMessage = sanitize(truncate(entry.message, 500));
    const safeStack = entry.stack
      ? sanitize(truncate(entry.stack, MAX_STACK_LENGTH))
      : undefined;
    this.buffer.push({
      ...entry,
      message: safeMessage,
      stack: safeStack,
      url: sanitize(window.location.pathname),
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
    });
    if (this.buffer.length >= this.batchSize) {
      this.flush();
    }
  }

  flush(): void {
    if (this.buffer.length === 0) return;
    // Drop buffered entries if consent has been revoked since they were captured
    if (getConsent() !== 'accepted') {
      this.buffer.length = 0;
      return;
    }
    const entries = this.buffer.splice(0);
    const body = JSON.stringify({ entries });
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(this.endpoint, blob);
    } else {
      fetch(this.endpoint, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
      }).catch(() => {
        // Observability must never throw
      });
    }
  }

  destroy(): void {
    if (this.timer !== undefined) {
      window.clearInterval(this.timer);
      this.timer = undefined;
    }
    this.flush();
  }
}

let shipper: BrowserLogShipper | undefined;

/**
 * Register global unhandledError and unhandledRejection listeners and start
 * the periodic flush cycle.
 *
 * Safe to call multiple times — subsequent calls are no-ops.
 *
 * @param endpoint - Backend endpoint that accepts browser log batches.
 *   Defaults to `/api/v1/logs/browser`. Must be same-origin or CORS-enabled.
 * @param flushIntervalMs - How often to flush the buffer. Default 10 000 ms.
 * @param batchSize - Maximum buffer size before an early flush. Default 20.
 */
export function initBrowserLogShipper(
  endpoint = '/api/v1/logs/browser',
  flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
  batchSize = DEFAULT_BATCH_SIZE,
): void {
  if (typeof window === 'undefined') return;
  if (shipper) return;

  shipper = new BrowserLogShipper(endpoint, flushIntervalMs, batchSize);

  window.addEventListener('error', (event: ErrorEvent) => {
    shipper?.capture({
      level: 'error',
      message: event.message ?? 'Unknown error',
      stack: event.error instanceof Error ? event.error.stack : undefined,
      line: event.lineno,
      col: event.colno,
    });
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : 'Unhandled promise rejection';
    const stack = reason instanceof Error ? reason.stack : undefined;
    shipper?.capture({ level: 'error', message, stack });
  });

  window.addEventListener('beforeunload', () => shipper?.flush());
}

/**
 * Manually capture a warning or error for log shipping without relying on the
 * global error boundary. Use in catch blocks where the error is handled but
 * should still be visible in the aggregation system.
 */
export function captureLogEntry(
  level: 'error' | 'warn',
  message: string,
  error?: Error,
): void {
  shipper?.capture({ level, message, stack: error?.stack });
}
