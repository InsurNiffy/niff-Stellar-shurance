import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HolderProfile } from '../entities/holder-profile.entity';
import { SupportTicket } from '../entities/support-ticket.entity';
import { PrivacyRequest } from '../entities/privacy-request.entity';
import { PrivacyService } from './privacy.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([HolderProfile, SupportTicket, PrivacyRequest]),
  ],
  providers: [PrivacyService],
  exports: [PrivacyService],
})
export class PrivacyModule {}
