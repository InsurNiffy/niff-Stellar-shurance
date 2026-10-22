import EventEmitter from 'events';
import { Injectable, ConflictException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './profile.dto';
import { maskEmail } from './email-mask';
import { shouldTouchLastSeen } from '../common/throttle/last-seen.throttle';
import type { HolderProfile } from '@prisma/client';

/** Fields written to the audit log with masked values. */
const SENSITIVE_FIELDS = new Set<string>(['email']);

/** In-process bus for privacy lifecycle events (e.g. `privacy.erasure_completed`). */
export const privacyBus = new EventEmitter();

export const ANONYMIZED_DISPLAY_NAME = '[deleted]';

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

      // Log audit trail for changed fields (emails masked — #1485)
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

  /**
   * GDPR right-to-erasure (Art. 17) for off-chain data: anonymizes the profile's
   * displayName/email and soft-deletes every ClaimComment authored by the wallet.
   * On-chain data is immutable and outside the scope of this operation.
   */
  async erase(walletAddress: string): Promise<{ commentsDeleted: number }> {
    const now = new Date();
    const [, comments] = await this.prisma.$transaction([
      this.prisma.holderProfile.updateMany({
        where: { walletAddress },
        data: { displayName: ANONYMIZED_DISPLAY_NAME, email: null },
      }),
      this.prisma.claimComment.updateMany({
        where: { authorAddress: walletAddress, deletedAt: null },
        data: { deletedAt: now, deletedBy: walletAddress },
      }),
    ]);

    privacyBus.emit('privacy.erasure_completed', {
      walletAddress,
      commentsDeleted: comments.count,
      completedAt: now.toISOString(),
    });

    return { commentsDeleted: comments.count };
  }

  /**
   * Records authenticated activity at most once per 5 minutes per user (#1485).
   * Fire-and-forget: never throws into the request path.
   */
  touchLastSeen(walletAddress: string): void {
    if (!shouldTouchLastSeen(walletAddress)) return;
    const now = new Date();
    this.prisma.holderProfile
      .upsert({
        where: { walletAddress },
        create: { walletAddress, lastSeenAt: now },
        update: { lastSeenAt: now },
      })
      .catch(() => undefined);
  }

  private async logProfileAudit(
    walletAddress: string,
    existing: HolderProfile | null,
    dto: UpdateProfileDto,
  ): Promise<void> {
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

      // Sensitive fields (email) are stored masked, never in plaintext.
      if (SENSITIVE_FIELDS.has(fieldName)) {
        auditEntries.push({
          fieldName,
          oldValue: maskEmail(typeof oldValue === 'string' ? oldValue : null),
          newValue: maskEmail(typeof newValue === 'string' ? newValue : null),
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
