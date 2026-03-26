import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class SubmitTransactionDto {
  @ApiProperty({
    description: 'Base64-encoded signed transaction envelope (XDR).',
    example: 'AAAAAgAAA...',
  })
  @IsString()
  @IsNotEmpty()
  transactionXdr: string;
}
