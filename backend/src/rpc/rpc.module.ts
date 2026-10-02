import { Module } from '@nestjs/common';
import { SorobanService } from '../soroban/soroban.service';

/** Alias used by keeper / deadline jobs (issue #650). */
export { SorobanService as SorobanRpcService } from '../soroban/soroban.service';

@Module({
  providers: [SorobanService],
  exports: [SorobanService],
})
export class RpcModule {}

