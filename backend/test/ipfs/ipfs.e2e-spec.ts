/**
 * IPFS E2E Tests
 * 
 * Tests for the IPFS upload endpoint using a mock provider.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { IpfsModule, IPFS_PROVIDER } from '../../src/ipfs/ipfs.module';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import FormData from 'form-data';
import { RedisService } from '../../src/cache/redis.service';

// Mock Redis service for testing
const mockRedisService = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  ping: jest.fn().mockResolvedValue(true),
};

describe('IPFS Upload (e2e)', () => {
  let app: INestApplication;
  let mockProvider: { name: string; upload: jest.Mock; isHealthy: jest.Mock };

  beforeEach(async () => {
    // Create mock IPFS provider
    mockProvider = {
      name: 'mock',
      upload: jest.fn().mockImplementation(async (buffer, filename, mimeType) => ({
        cid: `Qm${'a'.repeat(44)}`,
        size: buffer.length,
        mimeType,
        originalName: filename,
        pinnedAt: new Date(),
      })),
      isHealthy: jest.fn().mockResolvedValue(true),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env.test',
        }),
        ThrottlerModule.forRoot([
          {
            name: 'short',
            ttl: 60000,
            limit: 100, // High limit for testing
          },
        ]),
        IpfsModule,
      ],
      providers: [
        {
          provide: 'IPFS_PROVIDER',
          useValue: mockProvider,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
      ],
    })
      .overrideGuard(APP_GUARD)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    
    // Apply global pipes
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );

    // Enable shutdown hooks for cleanup
    app.enableShutdownHooks();

    await app.init();
  });

  afterEach(async () => {
    // Clear all mocks
    jest.clearAllMocks();
    
    if (app) {
      await app.close();
    }
  });

  /**
   * Helper to create a multipart form request
   */
  function createUploadRequest(
    fileBuffer: Buffer,
    filename: string,
    mimeType: string,
    idempotencyKey?: string,
  ) {
    const form = new FormData();
    form.append('file', fileBuffer, {
      filename,
      contentType: mimeType,
    });

    const headers: Record<string, string> = {
      ...form.getHeaders(),
    };

    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    return { form, headers };
  }

  describe('POST /ipfs/upload', () => {
    const testImage = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
      0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F,
      0x00, 0x05, 0xFE, 0x02, 0xFE, 0xA3, 0x56, 0xEB,
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44,
      0xAE, 0x42, 0x60, 0x82, // IEND chunk
    ]);

    const testPdf = Buffer.from(
      '%PDF-1.4\n' + // Minimal PDF structure
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n' +
      'xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n' +
      'trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n194\n%%EOF',
    );

    it('should successfully upload a valid image', async () => {
      const { form, headers } = createUploadRequest(
        testImage,
        'test-image.png',
        'image/png',
      );

      const response = await request(app.getHttpServer())
        .post('/ipfs/upload')
        .set(headers)
        .send(form);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('cid');
      expect(response.body).toHaveProperty('gatewayUrls');
      expect(response.body.gatewayUrls).toBeInstanceOf(Array);
      expect(response.body.gatewayUrls.length).toBeGreaterThan(0);
      expect(response.body).toHaveProperty('filename', 'test-image.png');
      expect(response.body).toHaveProperty('mimeType', 'image/png');
      expect(response.body).toHaveProperty('size', testImage.length);
      expect(response.body).toHaveProperty('uploadedAt');
      expect(response.body.duplicated).toBeFalsy();
    });

    it('should successfully upload a valid PDF', async () => {
      const { form, headers } = createUploadRequest(
        testPdf,
        'document.pdf',
        'application/pdf',
      );

      const response = await request(app.getHttpServer())
        .post('/ipfs/upload')
        .set(headers)
        .send(form);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('cid');
      expect(response.body).toHaveProperty('mimeType', 'application/pdf');
    });

    it('should reject upload without file', async () => {
      const response = await request(app.getHttpServer())
        .post('/ipfs/upload')
        .set({ 'Content-Type': 'multipart/form-data' })
        .send({});

      expect(response.status).toBe(400);
    });

    it('should reject unsupported file types', async () => {
      const executableBuffer = Buffer.from([0x4D, 0x5A, 0x90, 0x00]); // EXE signature
      const { form, headers } = createUploadRequest(
        executableBuffer,
        'malware.exe',
        'application/x-msdownload',
      );

      const response = await request(app.getHttpServer())
        .post('/ipfs/upload')
        .set(headers)
        .send(form);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('not allowed');
    });

    it('should handle idempotent requests', async () => {
      const idempotencyKey = 'test-key-12345678';
      
      // First request
      const { form: form1, headers: headers1 } = createUploadRequest(
        testImage,
        'test-image.png',
        'image/png',
        idempotencyKey,
      );

      const response1 = await request(app.getHttpServer())
        .post('/ipfs/upload')
        .set(headers1)
        .send(form1);

      expect(response1.status).toBe(200);
      const originalCid = response1.body.cid;

      // Second request with same idempotency key
      const { form: form2, headers: headers2 } = createUploadRequest(
        testImage,
        'test-image.png',
        'image/png',
        idempotencyKey,
      );

      const response2 = await request(app.getHttpServer())
        .post('/ipfs/upload')
        .set(headers2)
        .send(form2);

      expect(response2.status).toBe(200);
      expect(response2.body.cid).toBe(originalCid);
      expect(response2.body.duplicated).toBe(true);
      
      // Provider should only be called once
      expect(mockProvider.upload).toHaveBeenCalledTimes(1);
    });

    it('should reject invalid idempotency key format', async () => {
      const { form, headers } = createUploadRequest(
        testImage,
        'test-image.png',
        'image/png',
      );
      headers['Idempotency-Key'] = 'short'; // Too short (< 8 chars)

      const response = await request(app.getHttpServer())
        .post('/ipfs/upload')
        .set(headers)
        .send(form);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('8');
    });

    it('should return proper error when provider is unhealthy', async () => {
      mockProvider.isHealthy.mockResolvedValueOnce(false);

      const { form, headers } = createUploadRequest(
        testImage,
        'test-image.png',
        'image/png',
      );

      const response = await request(app.getHttpServer())
        .post('/ipfs/upload')
        .set(headers)
        .send(form);

      expect(response.status).toBe(503);
      expect(response.body.message).toContain('unavailable');
    });
  });

  describe('GET /ipfs/config', () => {
    it('should return upload configuration', async () => {
      const response = await request(app.getHttpServer())
        .get('/ipfs/config');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('maxFileSize');
      expect(response.body).toHaveProperty('maxFileSizeFormatted');
      expect(response.body).toHaveProperty('allowedMimeTypes');
      expect(response.body.allowedMimeTypes).toContain('image/png');
      expect(response.body.allowedMimeTypes).toContain('application/pdf');
      expect(response.body).toHaveProperty('ipfsImmutability');
      expect(response.body.ipfsImmutability).toHaveProperty('warning');
    });
  });

  describe('GET /ipfs/health', () => {
    it('should return health status', async () => {
      const response = await request(app.getHttpServer())
        .get('/ipfs/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('healthy', true);
      expect(response.body).toHaveProperty('provider', 'mock');
    });

    it('should return unhealthy when provider is down', async () => {
      mockProvider.isHealthy.mockResolvedValueOnce(false);

      const response = await request(app.getHttpServer())
        .get('/ipfs/health');

      expect(response.status).toBe(200);
      expect(response.body.healthy).toBe(false);
    });
  });
});
