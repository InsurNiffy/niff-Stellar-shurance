import { IsInt, IsString, Min, Max, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetRateLimitDto {
  @ApiProperty({
    description: 'Maximum number of claims allowed per window',
    minimum: 1,
    maximum: 100,
    example: 10,
  })
  @IsInt()
  @Min(1)
  @Max(100) // ABSOLUTE_MAX_CAP
  limit!: number;
}

export class EnableOverrideDto {
  @ApiProperty({
    description: 'Reason for enabling manual override (minimum 10 characters)',
    minLength: 10,
    example: 'Hurricane event affecting multiple policyholders in the region',
  })
  @IsString()
  @MinLength(10)
  reason!: string;
}
