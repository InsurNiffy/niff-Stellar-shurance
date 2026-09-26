import type { Request, Response } from 'express';
import type { AuthIdentity } from '../auth/auth-identity.service';

export type GraphqlRequest = Request & {
  requestId?: string;
  tenantId?: string | null;
  authIdentity?: AuthIdentity | null;
  /** Set by PersistedQueryMiddleware when the hash has a per-operation complexity budget. */
  persistedQueryMaxComplexity?: number;
};

export interface GraphqlContext {
  req: GraphqlRequest;
  res: Response;
}
