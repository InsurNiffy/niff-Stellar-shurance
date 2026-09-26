import { Injectable, ConflictException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './profile.dto';
import type { HolderProfile } from '@prisma/client';

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Returns the profile for the wallet, creating a default one on first access. */
  async getOrCreate(walletAddress: string): Promise<HolderProfile> {
    return this.prisma.holderProfile.upsert({
      where: { walletAddress },
      create: { walletAddress },
      update: {},
    });
  }

  /** Updates only the supplied fields for the wallet's own profile. */
  async update(walletAddress: string, dto: UpdateProfileDto): Promise<HolderProfile> {
    const notifPrefs = dto.notificationPreferences as Prisma.InputJsonValue | undefined;

    try {
      const existing = await this.prisma.holderProfile.findUnique({
        where: { walletAddress },
      });

      const updateData = {
        ...(dto.displayName !== undefined && { displayName: dto.displayName }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.locale !== undefined && { locale: dto.locale }),
        ...(notifPrefs !== undefined && { notificationPreferences: notifPrefs }),
      };

      // Log audit trail for changed fields
      await this.logProfileAudit(walletAddress, existing, dto);

      return await this.prisma.holderProfile.upsert({
        where: { walletAddress },
        create: {
          walletAddress,
          displayName: dto.displayName,
          email: dto.email,
          locale: dto.locale,
          notificationPreferences: notifPrefs ?? Prisma.JsonNull,
        },
        update: updateData,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.warn(`Wallet address already linked to another profile: ${walletAddress}`);
        throw new ConflictException('Wallet address is already linked to another profile');
      }
      throw err;
    }
  }

  private async logProfileAudit(
    walletAddress: string,
    existing: HolderProfile | null,
    dto: UpdateProfileDto,
  ): Promise<void> {
    const sensitiveFields = new Set<string>();
    const auditEntries: Array<{ fieldName: string; oldValue: string | null; newValue: string | null }> = [];

    const fieldMap = {
      displayName: dto.displayName,
      email: dto.email,
      locale: dto.locale,
      notificationPreferences: dto.notificationPreferences,
    };

    for (const [fieldName, newValue] of Object.entries(fieldMap)) {
      if (newValue === undefined) continue;

      const oldValue = existing ? (existing[fieldName as keyof HolderProfile] ?? null) : null;

      // Skip if no change
      if (JSON.stringify(oldValue) === JSON.stringify(newValue)) continue;

      // Exclude sensitive fields from plaintext logging
      if (sensitiveFields.has(fieldName)) {
        auditEntries.push({
          fieldName,
          oldValue: '[REDACTED]',
          newValue: '[REDACTED]',
        });
      } else {
        auditEntries.push({
          fieldName,
          oldValue: oldValue ? String(oldValue) : null,
          newValue: String(newValue),
        });
      }
    }

    if (auditEntries.length > 0) {
      for (const entry of auditEntries) {
        await this.prisma.profileAuditLog.create({
          data: {
            walletAddress,
            fieldName: entry.fieldName,
            oldValue: entry.oldValue,
            newValue: entry.newValue,
            actor: walletAddress, // User is updating their own profile
          },
        });
      }
    }
  }
}
