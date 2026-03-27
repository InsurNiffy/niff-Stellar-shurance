import { Module } from '@nestjs/common';
import { PolicyController } from './policy.controller';
import { PolicyService } from './policy.service';
import { RenewalController } from './renewal.controller';
import { RenewalService } from './renewal.service';
import { RpcModule } from '../rpc/rpc.module';

@Module({
  imports: [RpcModule],
  controllers: [PolicyController, RenewalController],
  providers: [PolicyService, RenewalService],
  exports: [RenewalService],
})
export class PolicyModule {}
