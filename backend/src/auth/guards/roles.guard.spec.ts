import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function makeContext(user: unknown, handler = {}, cls = {}): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('allows public routes regardless of user', () => {
    jest.spyOn(reflector, 'getAllAndOverride')
      .mockImplementationOnce(() => true)  // isPublic
      .mockImplementationOnce(() => ['admin']);
    expect(guard.canActivate(makeContext(null))).toBe(true);
  });

  it('allows routes with no required roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride')
      .mockImplementationOnce(() => false)
      .mockImplementationOnce(() => undefined);
    expect(guard.canActivate(makeContext({ walletAddress: 'G123' }))).toBe(true);
  });

  it('allows user with matching role', () => {
    jest.spyOn(reflector, 'getAllAndOverride')
      .mockImplementationOnce(() => false)
      .mockImplementationOnce(() => ['admin']);
    expect(guard.canActivate(makeContext({ walletAddress: 'G123', roles: ['admin'] }))).toBe(true);
  });

  it('throws 403 when user lacks required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride')
      .mockImplementationOnce(() => false)
      .mockImplementationOnce(() => ['admin']);
    expect(() => guard.canActivate(makeContext({ walletAddress: 'G123', roles: ['support'] }))).toThrow(ForbiddenException);
  });
});
