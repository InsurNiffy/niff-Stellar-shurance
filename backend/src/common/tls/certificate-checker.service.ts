import { Injectable, Logger } from '@nestjs/common';
import * as tls from 'tls';
import { promisify } from 'util';

/**
 * Certificate expiry check result.
 * Distinguishes between connection failures (unreachable) and certificate data (expiry date).
 */
export interface CertificateCheckResult {
  /** Hostname that was checked. */
  hostname: string;

  /** Current status: 'ok', 'expiring_soon', 'unreachable'. */
  status: 'ok' | 'expiring_soon' | 'unreachable';

  /** ISO 8601 timestamp of the certificate's notAfter date, if available. */
  expiryDate?: string;

  /** Days remaining until expiry (computed from current date). Only set if status != 'unreachable'. */
  daysRemaining?: number;

  /** Error message if status is 'unreachable'. */
  error?: string;

  /** Timestamp when this check was performed. */
  checkedAt: string;
}

/**
 * TLS Certificate Checker Service.
 * Connects to a hostname via TLS, extracts the peer certificate, and determines expiry.
 */
@Injectable()
export class CertificateCheckerService {
  private readonly logger = new Logger(CertificateCheckerService.name);

  /**
   * Check the TLS certificate expiry date for a given hostname.
   *
   * @param hostname - The hostname to check (e.g., 'api.example.com').
   * @param port - The port to connect to (default: 443).
   * @param timeoutMs - Connection timeout in milliseconds (default: 10000).
   * @returns CertificateCheckResult with expiry information or connection error.
   */
  async checkCertificateExpiry(
    hostname: string,
    port: number = 443,
    timeoutMs: number = 10000,
  ): Promise<CertificateCheckResult> {
    const checkedAt = new Date().toISOString();
    const baseResult: Partial<CertificateCheckResult> = {
      hostname,
      checkedAt,
    };

    try {
      // Create a TLS socket and connect to the hostname.
      const socket = tls.createConnection(
        {
          host: hostname,
          port,
          servername: hostname, // SNI: required for multi-tenant HTTPS
          rejectUnauthorized: false, // Allow self-signed for monitoring purposes
        },
        () => {
          // Connection established; extract certificate immediately.
          const cert = socket.getPeerCertificate();
          socket.destroy(); // Close the connection.
          return cert;
        },
      );

      // Wrap socket operations in a promise with timeout.
      const certPromise = new Promise<tls.PeerCertificate>((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          socket.destroy();
          reject(new Error(`Connection timeout after ${timeoutMs}ms`));
        }, timeoutMs);

        socket.on('secureConnect', () => {
          clearTimeout(timeoutHandle);
          const cert = socket.getPeerCertificate();
          socket.destroy();
          resolve(cert);
        });

        socket.on('error', (err) => {
          clearTimeout(timeoutHandle);
          socket.destroy();
          reject(err);
        });
      });

      const cert = await certPromise;

      // Parse the notAfter date from the certificate.
      if (!cert || !cert.valid_to) {
        return {
          ...baseResult,
          status: 'unreachable',
          error: 'Certificate missing valid_to field',
        } as CertificateCheckResult;
      }

      const expiryDate = new Date(cert.valid_to);
      const now = new Date();
      const daysRemaining = Math.ceil(
        (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      return {
        ...baseResult,
        status: daysRemaining > 0 ? 'ok' : 'expiring_soon',
        expiryDate: expiryDate.toISOString(),
        daysRemaining,
      } as CertificateCheckResult;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[tls-check] connection failed for ${hostname}:${port}: ${errorMsg}`,
      );
      return {
        ...baseResult,
        status: 'unreachable',
        error: errorMsg,
      } as CertificateCheckResult;
    }
  }

  /**
   * Check multiple hostnames in parallel (default: 5 concurrent connections).
   * Each result is tagged with its hostname.
   */
  async checkCertificatesExpiry(
    hostnames: string[],
    port: number = 443,
    concurrency: number = 5,
  ): Promise<CertificateCheckResult[]> {
    const results: CertificateCheckResult[] = [];
    const queue = [...hostnames];

    const worker = async () => {
      while (queue.length > 0) {
        const hostname = queue.shift();
        if (hostname) {
          const result = await this.checkCertificateExpiry(hostname, port);
          results.push(result);
        }
      }
    };

    // Run up to `concurrency` workers in parallel.
    const workers = Array.from({ length: Math.min(concurrency, hostnames.length) }, () =>
      worker(),
    );
    await Promise.all(workers);

    return results;
  }
}
