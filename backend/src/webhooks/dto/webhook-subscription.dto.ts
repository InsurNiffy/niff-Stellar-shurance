import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Events partners may subscribe to. */
export const WEBHOOK_EVENTS = [
  'policy.created',
  'claim.filed',
  'claim.finalized',
  'claim.paid',
  'vote.cast',
  'treasury.balance_low',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const HTTPS_URL_REGEX = /^https:\/\/[^\s]+$/i;

export class CreateWebhookSubscriptionDto {
  @ApiProperty({
    description: 'HTTPS endpoint that receives signed event POSTs.',
    example: 'https://partners.example.com/hooks/niffy',
  })
  @IsString()
  @Matches(HTTPS_URL_REGEX, { message: 'url must be an https:// URL' })
  @MaxLength(2048)
  url!: string;

  @ApiProperty({
    description: 'Events to deliver.',
    example: ['claim.finalized', 'claim.paid'],
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(WEBHOOK_EVENTS, { each: true })
  events!: WebhookEvent[];

  @ApiPropertyOptional({
    description: 'Signing secret (>= 16 chars). Auto-generated when omitted.',
    minLength: 16,
  })
  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(128)
  secret?: string;
}

export class UpdateWebhookSubscriptionDto {
  @ApiPropertyOptional({ description: 'New HTTPS endpoint.' })
  @IsOptional()
  @IsString()
  @Matches(HTTPS_URL_REGEX, { message: 'url must be an https:// URL' })
  @MaxLength(2048)
  url?: string;

  @ApiPropertyOptional({ description: 'Replacement event list.', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(WEBHOOK_EVENTS, { each: true })
  events?: WebhookEvent[];

  @ApiPropertyOptional({ description: 'Disable/enable the subscription.' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
