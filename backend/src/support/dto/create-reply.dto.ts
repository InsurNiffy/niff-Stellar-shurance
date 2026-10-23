import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateReplyDto {
  @ApiProperty({ example: 'Here is more detail...' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;
}
