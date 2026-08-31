import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './prisma.service';
import { PrismaReplicaService } from './prisma-replica.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [PrismaService, PrismaReplicaService],
  exports: [PrismaService, PrismaReplicaService],
})
export class PrismaModule {}
