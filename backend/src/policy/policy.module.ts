import { Module } from '@nestjs/common';
import { PolicyController } from './policy.controller';
import { PolicyService } from './policy.service';
import { RpcModule } from '../rpc/rpc.module';

@Module({
  imports: [RpcModule],
  controllers: [PolicyController],
  providers: [PolicyService],
})
export class PolicyModule {}
