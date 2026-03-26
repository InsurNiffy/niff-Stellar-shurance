import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTicketDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Issue with my policy' })
  @IsString()
  @MinLength(5)
  @MaxLength(120)
  subject: string;

  @ApiProperty({ example: 'I cannot find my policy document...' })
  @IsString()
  @MinLength(20)
  @MaxLength(2000)
  message: string;

  @ApiProperty({ description: 'CAPTCHA token from Turnstile/hCaptcha' })
  @IsString()
  @MinLength(1)
  captchaToken: string;
}
