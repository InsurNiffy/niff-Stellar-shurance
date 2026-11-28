import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { HolderProfile } from './entities/holder-profile.entity';
import { ProfileAuditLog } from './entities/profile-audit-log.entity';
import { PrivacyRequest } from './entities/privacy-request.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreatePrivacyRequestDto } from './dto/create-privacy-request.dto';

const AUDITED_FIELDS = ['displayName', 'email', 'preferences'] as const;
type AuditedField = (typeof AUDITED_FIELDS)[number];

@Injectable()
export class ProfileService {
  constructor(
    @InjectRepository(HolderProfile)
    private readonly profiles: Repository<HolderProfile>,
    @InjectRepository(ProfileAuditLog)
    private readonly auditLogs: Repository<ProfileAuditLog>,
    @InjectRepository(PrivacyRequest)
    private readonly privacyRequests: Repository<PrivacyRequest>,
  ) {}

  async getOrCreate(walletAddress: string): Promise<HolderProfile> {
    const existing = await this.profiles.findOne({ where: { walletAddress } });
    if (existing) {
      return existing;
    }
    const created = this.profiles.create({
      walletAddress,
      displayName: null,
      email: null,
      preferences: {},
    });
    return this.profiles.save(created);
  }

  async update(
    walletAddress: string,
    dto: UpdateProfileDto,
    actor: string,
  ): Promise<HolderProfile> {
    const profile = await this.getOrCreate(walletAddress);

    for (const field of AUDITED_FIELDS) {
      if (!(field in dto)) {
        continue;
      }
      const oldValue = profile[field];
      const newValue = dto[field];
      if (this.serialize(oldValue) === this.serialize(newValue)) {
        continue;
      }
      profile[field] = newValue as never;
      await this.auditLogs.save(
        this.auditLogs.create({
          walletAddress,
          field,
          oldValue: this.serialize(oldValue),
          newValue: this.serialize(newValue),
          actor,
        }),
      );
    }

    return this.profiles.save(profile);
  }

  async createPrivacyRequest(
    walletAddress: string,
    dto: CreatePrivacyRequestDto,
    actor: string,
  ): Promise<PrivacyRequest> {
    const profile = await this.profiles.findOne({ where: { walletAddress } });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    const request = await this.privacyRequests.save(
      this.privacyRequests.create({
        walletAddress,
        type: dto.type,
        status: 'pending',
        requestedBy: actor,
      }),
    );

    await this.anonymise(walletAddress, actor);

    request.status = 'completed';
    return this.privacyRequests.save(request);
  }

  private async anonymise(walletAddress: string, actor: string): Promise<void> {
    const profile = await this.profiles.findOne({ where: { walletAddress } });
    if (!profile) {
      return;
    }

    const placeholder = this.hash(walletAddress);
    const replacements: Partial<Record<AuditedField, unknown>> = {
      displayName: `anon-${placeholder.slice(0, 8)}`,
      email: null,
      preferences: {},
    };

    for (const field of AUDITED_FIELDS) {
      const oldValue = profile[field];
      const newValue = replacements[field];
      if (this.serialize(oldValue) === this.serialize(newValue)) {
        continue;
      }
      profile[field] = newValue as never;
      await this.auditLogs.save(
        this.auditLogs.create({
          walletAddress,
          field,
          oldValue: this.serialize(oldValue),
          newValue: this.serialize(newValue),
          actor,
        }),
      );
    }

    profile.anonymisedAt = new Date();
    await this.profiles.save(profile);
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private serialize(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
}
