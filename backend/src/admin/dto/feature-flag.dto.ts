import { IsBoolean, IsOptional, IsString, IsArray, ArrayNotEmpty, ArrayMaxSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FeatureFlagDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  key?: string;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

export class BulkFeatureFlagItemDto {
  @ApiProperty({ description: 'Feature flag key (must be in the predefined allowlist)' })
  @IsString()
  key!: string;

  @ApiProperty({ description: 'New enabled state for this flag' })
  @IsBoolean()
  enabled!: boolean;
}

export const BULK_FLAG_MAX_BATCH = 50;

export class BulkFeatureFlagDto {
  @ApiProperty({
    description: `Array of {key, enabled} pairs to apply atomically (max ${BULK_FLAG_MAX_BATCH})`,
    type: [BulkFeatureFlagItemDto],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BULK_FLAG_MAX_BATCH)
  @ValidateNested({ each: true })
  @Type(() => BulkFeatureFlagItemDto)
  updates!: BulkFeatureFlagItemDto[];
}
