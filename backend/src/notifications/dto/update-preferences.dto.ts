import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString } from 'class-validator';

export class UpdatePreferencesDto {
  @ApiProperty({ description: 'Opt in/out of email notifications' })
  @IsBoolean()
  emailEnabled: boolean;

  @ApiPropertyOptional({ description: 'Email address for notifications' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ description: 'Opt in/out of Discord DM notifications' })
  @IsBoolean()
  discordEnabled: boolean;

  @ApiPropertyOptional({ description: 'Discord user ID' })
  @IsOptional()
  @IsString()
  discordUserId?: string;

  @ApiProperty({ description: 'Opt in/out of Telegram notifications' })
  @IsBoolean()
  telegramEnabled: boolean;

  @ApiPropertyOptional({ description: 'Telegram chat ID' })
  @IsOptional()
  @IsString()
  telegramChatId?: string;
}

export class TriggerEventDto {
  @ApiProperty() @IsString() claimId: string;
  @ApiProperty() claimantPublicKey: string;
  @ApiProperty({ enum: ['Approved', 'Rejected'] })
  @IsString()
  outcome: 'Approved' | 'Rejected';
  @ApiProperty() policyId: number;
  @ApiPropertyOptional() @IsOptional() @IsString() finalizedAt?: string;
}
