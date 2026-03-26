import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReindexDto {
  @ApiProperty({ description: 'Ledger sequence to reindex from', minimum: 0 })
  @IsInt()
  @Min(0)
  fromLedger!: number;
}
