import { HttpException, HttpStatus } from '@nestjs/common';

export interface QueueBackpressureErrorDetails {
  queueName: string;
  currentDepth: number;
  maxDepth: number;
  retryAfterSeconds?: number;
}

export class QueueBackpressureException extends HttpException {
  constructor(details: QueueBackpressureErrorDetails) {
    const message =
      `Queue ${details.queueName} is at capacity (${details.currentDepth}/${details.maxDepth}). ` +
      `Please retry after a few seconds.`;

    const responseBody: Record<string, unknown> = {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      error: 'Service Unavailable',
      message,
      details: {
        queue: details.queueName,
        currentDepth: details.currentDepth,
        maxDepth: details.maxDepth,
      },
    };

    if (details.retryAfterSeconds && details.retryAfterSeconds > 0) {
      responseBody.retryAfter = details.retryAfterSeconds;
    }

    super(responseBody, HttpStatus.TOO_MANY_REQUESTS);
  }
}
