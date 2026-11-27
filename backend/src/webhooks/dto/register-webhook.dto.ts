import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

export class RegisterWebhookDto {
  @ApiProperty({
    description: 'HTTPS endpoint that will receive signed webhook deliveries',
    example: 'https://integrator.example.com/hooks/niffyinsure',
  })
  @IsUrl({ require_protocol: true, protocols: ['https', 'http'] })
  @MaxLength(2048)
  url!: string;

  @ApiProperty({
    description: 'Claim status events the subscriber wants to receive',
    example: ['claim.status_changed'],
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  events!: string[];

  @ApiPropertyOptional({
    description:
      'Optional client-supplied idempotency key. Duplicate registrations for the same URL are rejected regardless.',
    example: 'integrator-a-claims-hook',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  idempotencyKey?: string;

  @ApiPropertyOptional({
    description: 'Whether the webhook is active on creation',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
