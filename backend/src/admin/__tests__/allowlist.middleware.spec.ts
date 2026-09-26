import { AllowlistMiddleware } from '../middleware/allowlist.middleware';
import { ForbiddenException } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

function mockConfig(cidrs: string) {
  return { get: jest.fn((key: string) => (key === 'ADMIN_ALLOWED_CIDRS' ? cidrs : undefined)) };
}

function makeReq(ip: string, forwarded?: string): Request {
  return {
    ip,
    get: jest.fn((header: string) => {
      if (header === 'X-Forwarded-For') return forwarded ?? undefined;
      return undefined;
    }),
    socket: { remoteAddress: ip },
  } as unknown as Request;
}

function makeRes(): Response {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
}

describe('AllowlistMiddleware', () => {
  describe('empty allowlist (backward compatible)', () => {
    it('allows any IP when ADMIN_ALLOWED_CIDRS is empty', () => {
      const mw = new AllowlistMiddleware(mockConfig('') as never);
      const next: NextFunction = jest.fn();
      mw.use(makeReq('10.0.0.1'), makeRes(), next);
      expect(next).toHaveBeenCalled();
    });

    it('allows any IP when ADMIN_ALLOWED_CIDRS is unset', () => {
      const mw = new AllowlistMiddleware(mockConfig('') as never);
      const next: NextFunction = jest.fn();
      mw.use(makeReq('::1'), makeRes(), next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('single CIDR rule', () => {
    it('allows IP within the CIDR range', () => {
      const mw = new AllowlistMiddleware(mockConfig('10.0.0.0/24') as never);
      const next: NextFunction = jest.fn();
      mw.use(makeReq('10.0.0.42'), makeRes(), next);
      expect(next).toHaveBeenCalled();
    });

    it('blocks IP outside the CIDR range with ForbiddenException', () => {
      const mw = new AllowlistMiddleware(mockConfig('10.0.0.0/24') as never);
      const next: NextFunction = jest.fn();
      expect(() => mw.use(makeReq('10.0.1.1'), makeRes(), next)).toThrow(ForbiddenException);
      expect(next).not.toHaveBeenCalled();
    });

    it('blocks IP with 403 — no auth processing happens', () => {
      const mw = new AllowlistMiddleware(mockConfig('10.0.0.0/24') as never);
      const next: NextFunction = jest.fn();
      try {
        mw.use(makeReq('192.168.1.1'), makeRes(), next);
      } catch (e) {
        expect(e).toBeInstanceOf(ForbiddenException);
        expect((e as ForbiddenException).getStatus()).toBe(403);
        expect((e as ForbiddenException).message).toBe('Access denied');
      }
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('multiple CIDR rules', () => {
    it('allows IP matching any of the rules', () => {
      const mw = new AllowlistMiddleware(mockConfig('10.0.0.0/8,192.168.0.0/16') as never);
      const next: NextFunction = jest.fn();
      mw.use(makeReq('10.1.2.3'), makeRes(), next);
      expect(next).toHaveBeenCalled();
    });

    it('blocks IP not matching any rule', () => {
      const mw = new AllowlistMiddleware(mockConfig('10.0.0.0/8,192.168.0.0/16') as never);
      const next: NextFunction = jest.fn();
      expect(() => mw.use(makeReq('172.16.0.1'), makeRes(), next)).toThrow(ForbiddenException);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('IPv6 support', () => {
    it('allows IPv6 within the CIDR range', () => {
      const mw = new AllowlistMiddleware(mockConfig('2001:db8::/32') as never);
      const next: NextFunction = jest.fn();
      mw.use(makeReq('2001:db8:dead:beef::1'), makeRes(), next);
      expect(next).toHaveBeenCalled();
    });

    it('blocks IPv6 outside the CIDR range', () => {
      const mw = new AllowlistMiddleware(mockConfig('2001:db8::/32') as never);
      const next: NextFunction = jest.fn();
      expect(() => mw.use(makeReq('2001:db9::1'), makeRes(), next)).toThrow(ForbiddenException);
      expect(next).not.toHaveBeenCalled();
    });

    it('handles IPv6 with :: compression', () => {
      const mw = new AllowlistMiddleware(mockConfig('fd00::/8') as never);
      const next: NextFunction = jest.fn();
      mw.use(makeReq('fd12:3456:789a::1'), makeRes(), next);
      expect(next).toHaveBeenCalled();
    });

    it('handles ::1 loopback', () => {
      const mw = new AllowlistMiddleware(mockConfig('::1/128') as never);
      const next: NextFunction = jest.fn();
      mw.use(makeReq('::1'), makeRes(), next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('IPv4-mapped IPv6', () => {
    it('matches IPv4-mapped address against IPv4 CIDR rule', () => {
      const mw = new AllowlistMiddleware(mockConfig('10.0.0.0/24') as never);
      const next: NextFunction = jest.fn();
      mw.use(makeReq('::ffff:10.0.0.5'), makeRes(), next);
      expect(next).toHaveBeenCalled();
    });

    it('blocks IPv4-mapped address outside the IPv4 CIDR', () => {
      const mw = new AllowlistMiddleware(mockConfig('10.0.0.0/24') as never);
      const next: NextFunction = jest.fn();
      expect(() => mw.use(makeReq('::ffff:172.16.0.1'), makeRes(), next)).toThrow(ForbiddenException);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('X-Forwarded-For', () => {
    it('uses X-Forwarded-For header when present', () => {
      const mw = new AllowlistMiddleware(mockConfig('10.0.0.0/24') as never);
      const next: NextFunction = jest.fn();
      // req.ip is blocked but X-Forwarded-For is allowed
      mw.use(makeReq('192.168.1.1', '10.0.0.5'), makeRes(), next);
      expect(next).toHaveBeenCalled();
    });

    it('takes first IP from X-Forwarded-For chain', () => {
      const mw = new AllowlistMiddleware(mockConfig('10.0.0.0/24') as never);
      const next: NextFunction = jest.fn();
      mw.use(makeReq('192.168.1.1', '10.0.0.5, 192.168.1.1'), makeRes(), next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('non-leaky error message', () => {
    it('does not expose the allowlist config in the error', () => {
      const mw = new AllowlistMiddleware(mockConfig('10.0.0.0/24,192.168.0.0/16') as never);
      const next: NextFunction = jest.fn();
      try {
        mw.use(makeReq('1.2.3.4'), makeRes(), next);
      } catch (e) {
        expect(e).toBeInstanceOf(ForbiddenException);
        expect((e as ForbiddenException).message).toBe('Access denied');
        // Should not leak CIDR ranges
        expect((e as ForbiddenException).message).not.toContain('10.0.0.0');
        expect((e as ForbiddenException).message).not.toContain('192.168.0.0');
      }
    });
  });

  describe('edge cases', () => {
    it('allows exact /32 match', () => {
      const mw = new AllowlistMiddleware(mockConfig('10.0.0.42/32') as never);
      const next: NextFunction = jest.fn();
      mw.use(makeReq('10.0.0.42'), makeRes(), next);
      expect(next).toHaveBeenCalled();
    });

    it('blocks non-matching exact /32', () => {
      const mw = new AllowlistMiddleware(mockConfig('10.0.0.42/32') as never);
      const next: NextFunction = jest.fn();
      expect(() => mw.use(makeReq('10.0.0.43'), makeRes(), next)).toThrow(ForbiddenException);
    });

    it('allows /0 (all IPs)', () => {
      const mw = new AllowlistMiddleware(mockConfig('0.0.0.0/0') as never);
      const next: NextFunction = jest.fn();
      mw.use(makeReq('8.8.8.8'), makeRes(), next);
      expect(next).toHaveBeenCalled();
    });

    it('skips invalid CIDR entries without crashing', () => {
      const mw = new AllowlistMiddleware(mockConfig('not-a-cidr,10.0.0.0/24') as never);
      const next: NextFunction = jest.fn();
      mw.use(makeReq('10.0.0.1'), makeRes(), next);
      expect(next).toHaveBeenCalled();
    });
  });
});
