import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class SetTypingDto {
  @ApiProperty({
    description: 'True while staff is actively composing; false to clear immediately',
  })
  @IsBoolean()
  isTyping!: boolean;

  @ApiProperty({
    required: false,
    description: 'Optional staff identifier for audit/debug (not shown to customers)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  staffId?: string;
}
