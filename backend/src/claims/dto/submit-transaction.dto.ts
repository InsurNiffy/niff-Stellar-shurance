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

  @ApiProperty({
    description: 'Policy ID for rate limiting (format: holderAddress:policyId)',
    example: 'GABC...123:1',
  })
  @IsString()
  @IsNotEmpty()
  policyId: string;
}
