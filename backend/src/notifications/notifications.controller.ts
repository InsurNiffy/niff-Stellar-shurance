import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { NotificationsConsumer } from './notifications.consumer';
import { UpdatePreferencesDto, TriggerEventDto } from './dto/update-preferences.dto';
import { NotificationPreferenceKey } from './notification-preference.types';

const ALLOWED_PREFERENCE_KEYS: NotificationPreferenceKey[] = [
  'renewalRemindersEnabled',
  'claimUpdatesEnabled',
];

function isValidPublicKey(key: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(key);
}

function validateNotificationPreferenceUpdate(
  input: Record<string, unknown> | undefined,
): {
  renewalRemindersEnabled?: boolean;
  claimUpdatesEnabled?: boolean;
} {
  const body = input ?? {};
  const unknownFields = Object.keys(body).filter(
    (key) => !ALLOWED_PREFERENCE_KEYS.includes(key as NotificationPreferenceKey),
  );

  if (unknownFields.length > 0) {
    throw new BadRequestException({
      code: 'UNKNOWN_NOTIFICATION_PREFERENCE_FIELDS',
      message: `Unknown notification preference fields: ${unknownFields.join(', ')}`,
    });
  }

  const hasInvalidValue = Object.entries(body).some(
    ([key, value]) =>
      ALLOWED_PREFERENCE_KEYS.includes(key as NotificationPreferenceKey) &&
      typeof value !== 'boolean',
  );

  if (hasInvalidValue) {
    throw new BadRequestException({
      code: 'INVALID_NOTIFICATION_PREFERENCE_VALUE',
      message: 'Notification preferences must be boolean values when provided.',
    });
  }

  return {
    renewalRemindersEnabled:
      typeof body.renewalRemindersEnabled === 'boolean'
        ? body.renewalRemindersEnabled
        : undefined,
    claimUpdatesEnabled:
      typeof body.claimUpdatesEnabled === 'boolean'
        ? body.claimUpdatesEnabled
        : undefined,
  };
}

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly service: NotificationsService,
    private readonly consumer: NotificationsConsumer,
  ) {}

  /**
   * GET /api/notifications/preferences/:publicKey
   * Returns preferences with email/chat IDs partially masked.
   */
  @Get('preferences/:publicKey')
  @ApiOperation({ summary: 'Get notification preferences' })
  getPreferences(@Param('publicKey') publicKey: string) {
    if (!isValidPublicKey(publicKey)) {
      throw new BadRequestException({ code: 'INVALID_PUBLIC_KEY', message: 'Invalid Stellar public key.' });
    }
    const p = this.service.getPreferences(publicKey);
    return {
      claimantPublicKey: p.claimantPublicKey,
      emailEnabled: p.emailEnabled,
      email: p.email ? maskEmail(p.email) : undefined,
      discordEnabled: p.discordEnabled,
      discordUserId: p.discordUserId ? '***' : undefined,
      telegramEnabled: p.telegramEnabled,
      telegramChatId: p.telegramChatId ? '***' : undefined,
    };
  }

  @Get('users/:userId/preferences')
  @ApiOperation({ summary: 'Get per-user notification preferences' })
  async getUserNotificationPreferences(@Param('userId') userId: string) {
    const preferences = await this.service.getUserNotificationPreferences(userId);
    return { userId, preferences };
  }

  @Put('users/:userId/preferences')
  @ApiOperation({ summary: 'Update per-user notification preferences' })
  async updateUserNotificationPreferences(
    @Param('userId') userId: string,
    @Body() body: Record<string, unknown> | undefined,
  ) {
    const preferences = await this.service.updateUserNotificationPreferences(
      userId,
      validateNotificationPreferenceUpdate(body),
    );
    return { userId, preferences };
  }

  /**
   * PUT /api/notifications/preferences/:publicKey
   * Update opt-in/out preferences. Protect with JWT guard in production.
   */
  @Put('preferences/:publicKey')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update notification preferences (opt-in / opt-out)' })
  updatePreferences(
    @Param('publicKey') publicKey: string,
    @Body() dto: UpdatePreferencesDto,
  ) {
    if (!isValidPublicKey(publicKey)) {
      throw new BadRequestException({ code: 'INVALID_PUBLIC_KEY', message: 'Invalid Stellar public key.' });
    }
    this.service.updatePreferences({ claimantPublicKey: publicKey, ...dto });
    return { claimantPublicKey: publicKey };
  }

  /**
   * POST /api/notifications/trigger
   * Trigger a test claim finalization event. Restrict to internal traffic in production.
   */
  @Post('trigger')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Trigger a test claim finalization event' })
  @ApiResponse({ status: 202, description: 'Event queued' })
  triggerEvent(@Body() dto: TriggerEventDto) {
    this.consumer.emit({
      claimId: dto.claimId,
      policyId: dto.policyId,
      claimantPublicKey: dto.claimantPublicKey,
      outcome: dto.outcome,
      finalizedAt: dto.finalizedAt ?? new Date().toISOString(),
    });
    return { message: 'Claim finalization event queued.', claimId: dto.claimId };
  }
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***@***';
  return `${local.slice(0, 2)}***@${domain}`;
}
