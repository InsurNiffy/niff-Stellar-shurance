import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';
import { LastSeenInterceptor } from './last-seen.interceptor';

const makePrisma = () => ({
  holderProfile: { upsert: jest.fn().mockResolvedValue({}) },
});

const makeContext = (walletAddress?: string): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ user: walletAddress ? { walletAddress } : undefined }),
    }),
  }) as unknown as ExecutionContext;

const makeHandler = (): CallHandler => ({ handle: () => of('ok') });

describe('LastSeenInterceptor', () => {
  it('calls holderProfile.upsert with lastSeenAt when wallet present', (done) => {
    const prisma = makePrisma();
    const interceptor = new LastSeenInterceptor(prisma as never);
    interceptor.intercept(makeContext('GABC'), makeHandler()).subscribe(() => {
      expect(prisma.holderProfile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { walletAddress: 'GABC' },
          update: expect.objectContaining({ lastSeenAt: expect.any(Date) }),
        }),
      );
      done();
    });
  });

  it('does not call upsert when no wallet on request', (done) => {
    const prisma = makePrisma();
    const interceptor = new LastSeenInterceptor(prisma as never);
    interceptor.intercept(makeContext(), makeHandler()).subscribe(() => {
      expect(prisma.holderProfile.upsert).not.toHaveBeenCalled();
      done();
    });
  });
});
