import { IsEmail, IsIn, IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Locales supported by the frontend (frontend/messages). */
export const SUPPORTED_LOCALES = ['en', 'es'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** 1–80 chars, letters/digits/spaces plus . ' - _ (no control chars, no markup). */
const DISPLAY_NAME_REGEX = /^[A-Za-z0-9][A-Za-z0-9 .'\-_]{0,79}$/;

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Alice', maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(DISPLAY_NAME_REGEX, {
    message:
      'displayName must be 1-80 characters and contain only letters, digits, spaces, or . \' - _',
  })
  displayName?: string;

  @ApiPropertyOptional({ example: 'alice@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'en', enum: SUPPORTED_LOCALES as unknown as string[] })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  @IsIn(SUPPORTED_LOCALES as unknown as string[], {
    message: `locale must be one of: ${SUPPORTED_LOCALES.join(', ')}`,
  })
  locale?: string;

  @ApiPropertyOptional({ example: { renewalReminders: true } })
  @IsOptional()
  @IsObject()
  notificationPreferences?: Record<string, unknown>;
}
