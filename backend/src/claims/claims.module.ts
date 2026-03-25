import { Module } from '@nestjs/common';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';
import { SanitizationService } from './sanitization.service';

@Module({
  controllers: [ClaimsController],
  providers: [ClaimsService, SanitizationService],
  exports: [ClaimsService],
})
export class ClaimsModule {}
