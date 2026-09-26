import { Test, TestingModule } from '@nestjs/testing';
import { CertificateCheckerService } from './certificate-checker.service';
import * as tls from 'tls';

/**
 * Fixture certificate generator.
 * Creates mock PeerCertificate objects for testing.
 */
function createMockCertificate(expiryDaysFromNow: number): tls.PeerCertificate {
  const now = new Date();
  const expiryDate = new Date(now.getTime() + expiryDaysFromNow * 24 * 60 * 60 * 1000);
  const expiryDateStr = expiryDate.toUTCString();

  return {
    subject: { CN: 'example.com' },
    issuer: { CN: 'Example CA' },
    valid_from: new Date().toUTCString(),
    valid_to: expiryDateStr,
    fingerprint: 'AA:BB:CC',
    fingerprint256: 'AA:BB:CC:DD:EE',
    serialNumber: '1234567890',
    raw: Buffer.alloc(0),
  } as unknown as tls.PeerCertificate;
}

describe('CertificateCheckerService', () => {
  let service: CertificateCheckerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CertificateCheckerService],
    }).compile();

    service = module.get<CertificateCheckerService>(CertificateCheckerService);
  });

  describe('checkCertificateExpiry', () => {
    it('should return certificate expiry for a successfully connected socket', async () => {
      const expiryDaysFromNow = 60;
      const mockCert = createMockCertificate(expiryDaysFromNow);

      // Stub tls.createConnection to simulate a successful connection.
      const createConnectionSpy = jest.spyOn(tls, 'createConnection');
      createConnectionSpy.mockImplementation(
        (options, callback) => {
          // Simulate async socket creation and successful connection.
          const mockSocket = {
            getPeerCertificate: jest.fn(() => mockCert),
            destroy: jest.fn(),
            on: jest.fn((event, handler) => {
              if (event === 'secureConnect') {
                // Fire the event immediately (synchronously in this stub).
                setImmediate(handler);
              }
              return mockSocket;
            }),
          } as any;

          return mockSocket;
        },
      );

      const result = await service.checkCertificateExpiry('example.com');

      expect(result.hostname).toBe('example.com');
      expect(result.status).toBe('ok');
      expect(result.daysRemaining).toBeGreaterThan(0);
      expect(result.daysRemaining).toBeLessThanOrEqual(expiryDaysFromNow + 1); // Allow 1-day rounding
      expect(result.expiryDate).toBeDefined();
      expect(result.error).toBeUndefined();

      createConnectionSpy.mockRestore();
    });

    it('should return expiring_soon status when certificate expires within 30 days', async () => {
      const expiryDaysFromNow = 25;
      const mockCert = createMockCertificate(expiryDaysFromNow);

      const createConnectionSpy = jest.spyOn(tls, 'createConnection');
      createConnectionSpy.mockImplementation((options, callback) => {
        const mockSocket = {
          getPeerCertificate: jest.fn(() => mockCert),
          destroy: jest.fn(),
          on: jest.fn((event, handler) => {
            if (event === 'secureConnect') {
              setImmediate(handler);
            }
            return mockSocket;
          }),
        } as any;
        return mockSocket;
      });

      const result = await service.checkCertificateExpiry('example.com');

      expect(result.status).toBe('expiring_soon');
      expect(result.daysRemaining).toBeGreaterThan(0);
      expect(result.daysRemaining).toBeLessThanOrEqual(expiryDaysFromNow + 1);

      createConnectionSpy.mockRestore();
    });

    it('should handle connection timeouts', async () => {
      const createConnectionSpy = jest.spyOn(tls, 'createConnection');
      createConnectionSpy.mockImplementation((options) => {
        const mockSocket = {
          getPeerCertificate: jest.fn(),
          destroy: jest.fn(),
          on: jest.fn((event, handler) => {
            // Never fire secureConnect; let timeout occur.
            return mockSocket;
          }),
        } as any;
        return mockSocket;
      });

      const result = await service.checkCertificateExpiry('unreachable.example.com', 443, 100);

      expect(result.status).toBe('unreachable');
      expect(result.error).toContain('timeout');
      expect(result.expiryDate).toBeUndefined();
      expect(result.daysRemaining).toBeUndefined();

      createConnectionSpy.mockRestore();
    });

    it('should handle connection errors (e.g., ECONNREFUSED)', async () => {
      const createConnectionSpy = jest.spyOn(tls, 'createConnection');
      createConnectionSpy.mockImplementation((options) => {
        const mockSocket = {
          getPeerCertificate: jest.fn(),
          destroy: jest.fn(),
          on: jest.fn((event, handler) => {
            if (event === 'error') {
              setImmediate(() => handler(new Error('ECONNREFUSED')));
            }
            return mockSocket;
          }),
        } as any;
        return mockSocket;
      });

      const result = await service.checkCertificateExpiry('localhost:9999');

      expect(result.status).toBe('unreachable');
      expect(result.error).toContain('ECONNREFUSED');
      expect(result.expiryDate).toBeUndefined();

      createConnectionSpy.mockRestore();
    });

    it('should return checkedAt timestamp', async () => {
      const mockCert = createMockCertificate(90);
      const createConnectionSpy = jest.spyOn(tls, 'createConnection');
      createConnectionSpy.mockImplementation((options) => {
        const mockSocket = {
          getPeerCertificate: jest.fn(() => mockCert),
          destroy: jest.fn(),
          on: jest.fn((event, handler) => {
            if (event === 'secureConnect') {
              setImmediate(handler);
            }
            return mockSocket;
          }),
        } as any;
        return mockSocket;
      });

      const beforeCheck = new Date();
      const result = await service.checkCertificateExpiry('example.com');
      const afterCheck = new Date();

      expect(result.checkedAt).toBeDefined();
      const checkedTime = new Date(result.checkedAt);
      expect(checkedTime.getTime()).toBeGreaterThanOrEqual(beforeCheck.getTime());
      expect(checkedTime.getTime()).toBeLessThanOrEqual(afterCheck.getTime());

      createConnectionSpy.mockRestore();
    });
  });

  describe('checkCertificatesExpiry', () => {
    it('should check multiple hostnames in parallel', async () => {
      const mockCert25Days = createMockCertificate(25);
      const mockCert90Days = createMockCertificate(90);
      const mockCert5Days = createMockCertificate(5);

      let callCount = 0;
      const createConnectionSpy = jest.spyOn(tls, 'createConnection');
      createConnectionSpy.mockImplementation((options) => {
        callCount++;
        // Vary the mock certificate based on the hostname.
        let cert = mockCert90Days;
        if ((options as any).host === 'expiring-25.example.com') {
          cert = mockCert25Days;
        } else if ((options as any).host === 'expiring-5.example.com') {
          cert = mockCert5Days;
        }

        const mockSocket = {
          getPeerCertificate: jest.fn(() => cert),
          destroy: jest.fn(),
          on: jest.fn((event, handler) => {
            if (event === 'secureConnect') {
              setImmediate(handler);
            }
            return mockSocket;
          }),
        } as any;
        return mockSocket;
      });

      const results = await service.checkCertificatesExpiry(
        ['expiring-25.example.com', 'expiring-5.example.com', 'ok.example.com'],
        443,
        5,
      );

      expect(results).toHaveLength(3);
      expect(results[0].status).toBe('expiring_soon');
      expect(results[1].status).toBe('expiring_soon');
      expect(results[2].status).toBe('ok');

      createConnectionSpy.mockRestore();
    });

    it('should handle mixed success and failure results', async () => {
      const mockCert = createMockCertificate(90);
      const createConnectionSpy = jest.spyOn(tls, 'createConnection');
      let callCount = 0;

      createConnectionSpy.mockImplementation((options) => {
        callCount++;
        const host = (options as any).host;

        if (host === 'unreachable.example.com') {
          // Simulate connection error for this hostname.
          const mockSocket = {
            getPeerCertificate: jest.fn(),
            destroy: jest.fn(),
            on: jest.fn((event, handler) => {
              if (event === 'error') {
                setImmediate(() => handler(new Error('ECONNREFUSED')));
              }
              return mockSocket;
            }),
          } as any;
          return mockSocket;
        }

        // Successful connection for other hostnames.
        const mockSocket = {
          getPeerCertificate: jest.fn(() => mockCert),
          destroy: jest.fn(),
          on: jest.fn((event, handler) => {
            if (event === 'secureConnect') {
              setImmediate(handler);
            }
            return mockSocket;
          }),
        } as any;
        return mockSocket;
      });

      const results = await service.checkCertificatesExpiry(
        ['ok.example.com', 'unreachable.example.com', 'ok2.example.com'],
        443,
        5,
      );

      expect(results).toHaveLength(3);
      const okResults = results.filter((r) => r.status === 'ok');
      const unreachableResults = results.filter((r) => r.status === 'unreachable');
      expect(okResults.length).toBe(2);
      expect(unreachableResults.length).toBe(1);
      expect(unreachableResults[0].hostname).toBe('unreachable.example.com');
      expect(unreachableResults[0].error).toContain('ECONNREFUSED');

      createConnectionSpy.mockRestore();
    });
  });
});
