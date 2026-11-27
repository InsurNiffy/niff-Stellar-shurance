import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HolderProfile } from './entities/holder-profile.entity';
import { ProfileAuditLog } from './entities/profile-audit-log.entity';
import { PrivacyRequest } from './entities/privacy-request.entity';
import { ProfileService } from './profile.service';
import { PrivacyService } from './privacy.service';
import { ProfileController } from './profile.controller';
import { AdminPrivacyController } from './admin-privacy.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([HolderProfile, ProfileAuditLog, PrivacyRequest]),
  ],
  controllers: [ProfileController, AdminPrivacyController],
  providers: [ProfileService, PrivacyService],
  exports: [ProfileService, PrivacyService],
})
export class ProfileModule {}
