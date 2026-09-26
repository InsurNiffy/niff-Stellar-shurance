import { IsOptional, IsString, IsBoolean, IsInt, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class SearchPoliciesDto {
  @ApiPropertyOptional({ description: 'Filter by holder address (ILIKE prefix match)' })
  @IsOptional()
  @IsString()
  holder?: string;

  @ApiPropertyOptional({ description: 'Filter by policy type (exact match)' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: 'Filter by region (exact match)' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ description: 'Filter by active status' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ description: 'Opaque cursor for keyset pagination' })
  @IsOptional()
  @IsString()
  after?: string;

  @ApiPropertyOptional({ description: 'Number of results to return (1–100, default 20)' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value !== undefined ? Number(value) : undefined))
  @IsInt()
  @Min(1)
  @Max(100)
  first?: number;
}
