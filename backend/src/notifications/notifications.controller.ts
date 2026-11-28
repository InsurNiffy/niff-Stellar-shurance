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
   * GET /api/notifications
   * Returns unacknowledged notification records for the authenticated user.
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List unacknowledged notifications for authenticated user' })
  @ApiResponse({ status: 200, description: 'Unacknowledged notifications' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async listUnacknowledged(@WalletAddress() walletAddress: string) {
    return this.service.getUnacknowledgedNotifications(walletAddress);
  }

  /**
   * POST /api/notifications/ack
   * Acknowledge one or more notifications for the authenticated user.
   */
  @Post('ack')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Acknowledge notifications for authenticated user' })
  @ApiResponse({ status: 200, description: 'Notifications acknowledged' })
  @ApiResponse({ status: 400, description: 'Invalid acknowledgement payload' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async acknowledge(
    @WalletAddress() walletAddress: string,
    @Body() body: { ids?: unknown },
  ) {
    const ids = body?.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== 'string')) {
      throw new BadRequestException({
        code: 'INVALID_ACK_PAYLOAD',
        message: 'ids must be a non-empty array of notification id strings.',
      });
    }
    const acknowledged = await this.service.acknowledgeNotifications(walletAddress, ids as string[]);
    return { acknowledged };
  }

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
  async updateRoutingPref

/* … truncated 7822 chars — edit only what you need near the top … */
