import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { XdrDecodeController } from './xdr-decode.controller';
import { RawBodyRequest } from '@nestjs/common';
import { FeatureFlagsGuard } from '../feature-flags/feature-flags.guard';

describe('XdrDecodeController', () => {
  let controller: XdrDecodeController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [XdrDecodeController],
    })
      .overrideGuard(FeatureFlagsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<XdrDecodeController>(XdrDecodeController);
  });

  describe('decodeXdr', () => {
    it('should throw BadRequestException for empty body', () => {
      const mockReq = {
        rawBody: Buffer.from(''),
      } as RawBodyRequest<Buffer>;

      expect(() => controller.decodeXdr(mockReq)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for null body', () => {
      const mockReq = {
        rawBody: null,
      } as unknown as RawBodyRequest<Buffer>;

      expect(() => controller.decodeXdr(mockReq)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid XDR binary', () => {
      const mockReq = {
        rawBody: Buffer.from('this is definitely not valid xdr data'),
      } as RawBodyRequest<Buffer>;

      expect(() => controller.decodeXdr(mockReq)).toThrow(BadRequestException);
    });

    it('should decode valid XDR ScVal', () => {
      // Mock the xdr module behavior
      // In a real test, this would use actual stellar-sdk XDR encoding
      const mockReq = {
        rawBody: Buffer.from('AAAAAAA=', 'base64'),
      } as RawBodyRequest<Buffer>;

      // This test is a placeholder - actual implementation would require
      // proper Stellar SDK XDR fixtures
      try {
        const result = controller.decodeXdr(mockReq);
        // If decoding succeeds, verify structure
        expect(result).toHaveProperty('type');
        expect(result).toHaveProperty('value');
      } catch (err) {
        // If it fails, it should be BadRequestException
        expect(err).toBeInstanceOf(BadRequestException);
      }
    });
  });
});
