export interface ErrorCatalogEntry {
  httpStatus: number;
  i18nKey: string;
  description: string;
}

export const ErrorCatalog = {
  VALIDATION_FAILED: {
    httpStatus: 400,
    i18nKey: 'errors.validationFailed',
    description: 'Request payload failed validation.',
  },
  UNAUTHORIZED: {
    httpStatus: 401,
    i18nKey: 'errors.unauthorized',
    description: 'Authentication is required or invalid.',
  },
  FORBIDDEN: {
    httpStatus: 403,
    i18nKey: 'errors.forbidden',
    description: 'The caller is not allowed to perform this action.',
  },
  NOT_FOUND: {
    httpStatus: 404,
    i18nKey: 'errors.notFound',
    description: 'The requested resource does not exist.',
  },
  CONFLICT: {
    httpStatus: 409,
    i18nKey: 'errors.conflict',
    description: 'The request conflicts with the current state.',
  },
  RATE_LIMITED: {
    httpStatus: 429,
    i18nKey: 'errors.rateLimited',
    description: 'Too many requests; retry later.',
  },
  INTERNAL_ERROR: {
    httpStatus: 500,
    i18nKey: 'errors.internal',
    description: 'An unexpected internal error occurred.',
  },
  SERVICE_UNAVAILABLE: {
    httpStatus: 503,
    i18nKey: 'errors.serviceUnavailable',
    description: 'The service is temporarily unavailable.',
  },
} as const satisfies Record<string, ErrorCatalogEntry>;

export type ErrorCode = keyof typeof ErrorCatalog;

export function isKnownErrorCode(code: string): code is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ErrorCatalog, code);
}

export function getCatalogEntry(code: string): ErrorCatalogEntry {
  if (isKnownErrorCode(code)) {
    return ErrorCatalog[code];
  }
  return ErrorCatalog.INTERNAL_ERROR;
}
