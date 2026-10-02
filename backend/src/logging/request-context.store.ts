import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  requestId: string;
  walletAddress?: string;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export function getRequestId(): string | undefined {
  return requestContextStorage.getStore()?.requestId;
}
