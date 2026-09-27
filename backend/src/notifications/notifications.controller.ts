import {
  Controller,
  Get,
  Put,
  Patch,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { NotificationsConsumer } from './notifications.consumer';
import { UpdatePreferencesDto, TriggerEventDto } from './dto/update-preferences.dto';
import {
  NOTIFICATION_TYPES,
  NotificationPreferenceKey,
  NotificationType,
} from './notification-preference.types';
import { resolveUnsubscribeSecret, verifyUnsubscribeToken } from './unsubscribe';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletAddress } from '../auth/decorators/wallet-address.decorator';

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

type RoutingPreferencesInput = {
  events?: Partial<Record<NotificationType, { email?: boolean; inApp?: boolean }>>;
  quietHours?: { enabled?: boolean; start?: string; end?: string };
  digestMode?: 'off' | 'daily' | 'batch';
};

const HH_MM = /^([01]?\d|2[0-3]):[0-5]\d$/;
const DIGEST_MODES = ['off', 'daily', 'batch'] as const;

/**
 * Validates the PUT /notifications/preferences body (per event × channel,
 * quiet hours, digest mode). Unknown fields are rejected.
 */
function validateRoutingPreferencesUpdate(
  input: Record<string, unknown> | undefined,
): RoutingPreferencesInput {
  const body = input ?? {};
  const allowed = ['events', 'quietHours', 'digestMode'];
  const unknownFields = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknownFields.length > 0) {
    throw new BadRequestException({
      code: 'UNKNOWN_ROUTING_PREFERENCE_FIELDS',
      message: `Unknown routing preference fields: ${unknownFields.join(', ')}`,
    });
  }

  const result: RoutingPreferencesInput = {};

  if (body.events !== undefined) {
    const events = body.events;
    if (!events || typeof events !== 'object' || Array.isArray(events)) {
      throw new BadRequestException({ code: 'INVALID_ROUTING_PREFERENCES', message: 'events must be an object.' });
    }
    const eventInput: RoutingPreferencesInput['events'] = {};
    for (const [type, value] of Object.entries(events as Record<string, unknown>)) {
      if (!NOTIFICATION_TYPES.includes(type as NotificationType)) {
        throw new BadRequestException({ code: 'INVALID_NOTIFICATION_TYPE', message: `Unknown notification type: ${type}` });
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new BadRequestException({ code: 'INVALID_ROUTING_PREFERENCES', message: `events.${type} must be an object.` });
      }
      const channelInput: { email?: boolean; inApp?: boolean } = {};
      for (const [channel, flag] of Object.entries(value as Record<string, unknown>)) {
        if (channel !== 'email' && channel !== 'inApp') {
          throw new BadRequestException({ code: 'UNKNOWN_ROUTING_CHANNEL', message: `Unknown channel: ${channel}` });
        }
        if (typeof flag !== 'boolean') {
          throw new BadRequestException({ code: 'INVALID_ROUTING_PREFERENCES', message: `events.${type}.${channel} must be a boolean.` });
        }
        channelInput[channel] = flag;
      }
      eventInput[type as NotificationType] = channelInput;
    }
    result.events = eventInput;
  }

  if (body.quietHours !== undefined) {
    const quiet = body.quietHours;
    if (!quiet || typeof quiet !== 'object' || Array.isArray(quiet)) {
      throw new BadRequestException({ code: 'INVALID_QUIET_HOURS', message: 'quietHours must be an object.' });
    }
    const quietInput: { enabled?: boolean; start?: string; end?: string } = {};
    for (const [key, value] of Object.entries(quiet as Record<string, unknown>)) {
      if (key !== 'enabled' && key !== 'start' && key !== 'end') {
        throw new BadRequestException({ code: 'UNKNOWN_QUIET_HOURS_FIELD', message: `Unknown quietHours field: ${key}` });
      }
      if (key === 'enabled') {
        if (typeof value !== 'boolean') {
          throw new BadRequestException({ code: 'INVALID_QUIET_HOURS', message: 'quietHours.enabled must be a boolean.' });
        }
        quietInput.enabled = value;
      } else {
        if (typeof value !== 'string' || !HH_MM.test(value)) {
          throw new BadRequestException({ code: 'INVALID_QUIET_HOURS', message: `quietHours.${key} must be an HH:mm time.` });
        }
        quietInput[key === 'start' ? 'start' : 'end'] = value;
      }
    }
    result.quietHours = quietInput;
  }

  if (body.digestMode !== undefined) {
    if (!DIGEST_MODES.includes(body.digestMode as (typeof DIGEST_MODES)[number])) {
      throw new BadRequestException({ code: 'INVALID_DIGEST_MODE', message: 'digestMode must be one of: off, daily, batch.' });
    }
    result.digestMode = body.digestMode as 'off' | 'daily' | 'batch';
  }

  return result;
}

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly service: NotificationsService,
    private readonly consumer: NotificationsConsumer,
    private readonly configService: ConfigService,
  ) {}

  /**
   * GET /api/notifications/preferences
   * Returns notification preferences for authenticated wallet user.
   * On first access, creates preference record with defaults.
   */
  @Get('preferences')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get authenticated user notification preferences' })
  @ApiResponse({ status: 200, description: 'User notification preferences' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getAuthenticatedUserPreferences(
    @WalletAddress() walletAddress: string,
  ) {
    const [preferences, routing] = await Promise.all([
      this.service.getUserNotificationPreferences(walletAddress),
      this.service.getRoutingPreferences(walletAddress),
    ]);
    return { ...preferences, ...routing };
  }

  /**
   * PUT /api/v1/notifications/preferences
   * Per event × channel routing, quiet hours and digest mode.
   */
  @Put('preferences')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update notification routing preferences (channels, quiet hours, digest)' })
  @ApiResponse({ status: 200, description: 'Updated routing preferences' })
  @ApiResponse({ status: 400, description: 'Invalid routing preferences' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async updateRoutingPreferences(
    @WalletAddress() walletAddress: string,
    @Body() body: Record<string, unknown> | undefined,
  ) {
    return this.service.updateRoutingPreferences(
      walletAddress,
      validateRoutingPreferencesUpdate(body),
    );
  }

  /**
   * GET /api/v1/notifications
   * Cursor-paginated in-app notification listing (newest first).
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List in-app notifications (cursor paginated)' })
  @ApiResponse({ status: 200, description: 'Notification page with nextCursor/hasMore' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async listNotifications(
    @WalletAddress() walletAddress: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit !== undefined ? Number(limit) : undefined;
    if (parsedLimit !== undefined && (!Number.isFinite(parsedLimit) || parsedLimit < 1)) {
      throw new BadRequestException({ code: 'INVALID_NOTIFICATION_LIMIT', message: 'limit must be a positive number.' });
    }
    return this.service.listNotifications(walletAddress, {
      cursor: cursor || undefined,
      limit: parsedLimit,
    });
  }

  /**
   * POST /api/v1/notifications/:id/read
   * Marks a notification as read (sets the read marker).
   */
  @Post(':id/read')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiResponse({ status: 204, description: 'Notification marked as read' })
  @ApiResponse({ status: 404, description: 'Notification not found or not owned by caller' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async markNotificationRead(
    @Param('id') id: string,
    @WalletAddress() userId: string,
  ) {
    await this.service.markNotificationRead(id, userId);
  }

  /**
   * PATCH /api/notifications/preferences
   * Updates notification preferences for authenticated wallet user.
   * Validates fields and applies only the provided fields.
   */
  @Patch('preferences')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update authenticated user notification preferences' })
  @ApiResponse({ status: 200, description: 'Updated notification preferences' })
  @ApiResponse({ status: 400, description: 'Invalid preferences' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async updateAuthenticatedUserPreferences(
    @WalletAddress() walletAddress: string,
    @Body() body: Record<string, unknown> | undefined,
  ) {
    const preferences = await this.service.updateUserNotificationPreferences(
      walletAddress,
      validateNotificationPreferenceUpdate(body),
    );
    return preferences;
  }

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
   * POST /api/notifications/:id/ack
   * Mark a notification as delivered. Called by the frontend on render.
   * Idempotent — repeat calls for an already-acknowledged notification are no-ops.
   */
  @Post(':id/ack')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Acknowledge a notification (mark as delivered)' })
  @ApiResponse({ status: 204, description: 'Notification acknowledged' })
  @ApiResponse({ status: 404, description: 'Notification not found or not owned by caller' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async acknowledgeNotification(
    @Param('id') id: string,
    @WalletAddress() userId: string,
  ) {
    await this.service.acknowledgeNotification(id, userId);
  }

  /**
   * POST /api/v1/notifications/unsubscribe?token=…
   * RFC 8058 one-click unsubscribe. Unauthenticated by necessity — the
   * signed HMAC token is the credential. Verifies the token, then disables
   * email delivery for the user (per scope, or all email when scope covers
   * every type).
   */
  @Post('unsubscribe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'One-click unsubscribe (RFC 8058)' })
  @ApiResponse({ status: 200, description: 'Email delivery disabled' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async unsubscribe(
    @Query('token') token?: string,
    @Body() _body?: unknown,
  ) {
    const secret = resolveUnsubscribeSecret(this.configService);
    const payload = verifyUnsubscribeToken(token, secret);
    if (!payload) {
      throw new BadRequestException({
        code: 'INVALID_UNSUBSCRIBE_TOKEN',
        message: 'Invalid or expired unsubscribe token.',
      });
    }
    const result = await this.service.unsubscribeFromEmail(
      payload.userId,
      payload.scope,
    );
    return { unsubscribed: result.unsubscribed, scope: result.scope };
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
