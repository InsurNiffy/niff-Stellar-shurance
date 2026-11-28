import { Router, Request, Response } from 'express';
import { SorobanRpcService } from '../soroban/soroban-rpc.service';

export function createHealthRouter(sorobanRpcService?: SorobanRpcService): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    const breakerState = sorobanRpcService?.getBreakerState() ?? 'closed';
    const healthy = breakerState !== 'open';

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      soroban: {
        breaker: breakerState,
      },
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
