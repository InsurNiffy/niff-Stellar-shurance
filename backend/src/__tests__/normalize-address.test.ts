import { normalizeAddress, tryNormalizeAddress } from '../common/utils/normalize-address';
import { BadRequestException } from '@nestjs/common';

// Valid test fixtures
const G_ADDRESS = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';
const C_ADDRESS = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
// Muxed address encoding the same G_ADDRESS with mux ID 1
// Generated via: new MuxedAccount(new Account(G_ADDRESS, '0'), BigInt(1)).accountId()
const M_ADDRESS = 'MA7QYNF7SOWQ3GLR2BGMZEHXR3IXDOQNKWKBWX5AAAAAAAAAPCIBVZA';

describe('normalizeAddress', () => {
  it('returns G-address unchanged', () => {
    expect(normalizeAddress(G_ADDRESS)).toBe(G_ADDRESS);
  });

  it('returns C-address unchanged', () => {
    expect(normalizeAddress(C_ADDRESS)).toBe(C_ADDRESS);
  });

  it('strips mux ID from M-address and returns base G-address', () => {
    const result = normalizeAddress(M_ADDRESS);
    expect(result).toMatch(/^G[A-Z2-7]{55}$/);
  });

  it('trims whitespace before validating', () => {
    expect(normalizeAddress(`  ${G_ADDRESS}  `)).toBe(G_ADDRESS);
  });

  it('throws BadRequestException for empty string', () => {
    expect(() => normalizeAddress('')).toThrow(BadRequestException);
  });

  it('throws BadRequestException for garbage input', () => {
    expect(() => normalizeAddress('not-an-address')).toThrow(BadRequestException);
  });

  it('throws BadRequestException with INVALID_ADDRESS code', () => {
    try {
      normalizeAddress('BADADDRESS');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const response = (err as BadRequestException).getResponse() as Record<string, string>;
      expect(response.code).toBe('INVALID_ADDRESS');
    }
  });
});

describe('tryNormalizeAddress', () => {
  it('returns normalized address on valid input', () => {
    expect(tryNormalizeAddress(G_ADDRESS)).toBe(G_ADDRESS);
  });

  it('returns null on invalid input', () => {
    expect(tryNormalizeAddress('garbage')).toBeNull();
  });
});
