import { Injectable, Scope, Inject } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Request } from 'express';

@Injectable({ scope: Scope.REQUEST })
export class RequestIdService {
  constructor(@Inject(REQUEST) private req: Request) {}

  getRequestId(): string {
    const requestId = this.req.headers['x-request-id'];
    return typeof requestId === 'string' ? requestId : '';
  }
}
