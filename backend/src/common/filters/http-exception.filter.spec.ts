import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import { AppException, ERROR_CATALOG, ErrorCode } from '../errors';

function run(exception: unknown) {
  const json = jest.fn();
  const res = { status: jest.fn().mockReturnValue({ json }) };
  const req = { method: 'GET', url: '/api/v1/test', requestId: 'req-1' };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;
  new HttpExceptionFilter().catch(exception, host);
  return { status: res.status.mock.calls[0][0] as number, body: json.mock.calls[0][0] };
}

describe('HttpExceptionFilter (RFC 7807)', () => {
  const catalog4xx = (Object.keys(ERROR_CATALOG) as ErrorCode[]).filter(
    (code) => ERROR_CATALOG[code].httpStatus >= 400 && ERROR_CATALOG[code].httpStatus < 500,
  );

  it.each(catalog4xx)('catalog code %s yields a problem detail with a type', (code) => {
    const { status, body } = run(new AppException(code));
    expect(status).toBe(ERROR_CATALOG[code].httpStatus);
    expect(body).toMatchObject({
      type: `/api/v1/errors#${code}`,
      status,
      instance: '/api/v1/test',
      extensions: { code, i18nKey: ERROR_CATALOG[code].i18nKey, requestId: 'req-1' },
    });
    expect(typeof body.title).toBe('string');
    expect(typeof body.detail).toBe('string');
  });

  it.each([
    new BadRequestException('bad'),
    new UnauthorizedException(),
    new ForbiddenException(),
    new NotFoundException(),
    new ConflictException(),
    new HttpException('teapot', 418),
  ])('framework 4xx exception %p includes a type field', (exception) => {
    const { status, body } = run(exception);
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
    expect(typeof body.type).toBe('string');
    expect(body.type.length).toBeGreaterThan(0);
    expect(body.status).toBe(status);
  });

  it('keeps the legacy envelope and passes details through extensions', () => {
    const { body } = run(
      new AppException('RATE_LIMIT_EXCEEDED', { details: { retryAfter: 30 } }),
    );
    expect(body.extensions.details).toEqual({ retryAfter: 30 });
    expect(body.errors[0].code).toBe('RATE_LIMIT_EXCEEDED');
    expect(body.meta.statusCode).toBe(429);
  });
});
