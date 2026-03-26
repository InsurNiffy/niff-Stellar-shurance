import { HttpException, HttpStatus } from '@nestjs/common';

export interface RateLimitErrorDetails {
  policyId: string;
  currentCount: number;
  limit: number;
  windowResetLedger: number;
  remainingLedgers: number;
}

export class RateLimitException extends HttpException {
  constructor(details: RateLimitErrorDetails) {
    const message =
      `Rate limit exceeded for policy ${details.policyId}. ` +
      `Current: ${details.currentCount}/${details.limit}. ` +
      `Window resets in ${details.remainingLedgers} ledgers (ledger ${details.windowResetLedger}).`;

    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
        message,
        details,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
