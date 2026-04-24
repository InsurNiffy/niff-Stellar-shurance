import type { Request, Response } from 'express';
import type { AuthIdentity } from '../auth/auth-identity.service';

export type GraphqlRequest = Request & {
  requestId?: string;
  tenantId?: string | null;
  authIdentity?: AuthIdentity | null;
};

export interface GraphqlContext {
  req: GraphqlRequest;
  res: Response;
}
