import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export enum PolicyStatusFilter {
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
  CLAIMED = 'CLAIMED',
}

export enum PolicyTypeFilter {
  AUTO = 'AUTO',
  HEALTH = 'HEALTH',
  LIFE = 'LIFE',
  PROPERTY = 'PROPERTY',
  TRAVEL = 'TRAVEL',
}

export class PolicyQueryDto {
  @IsOptional()
  @IsString()
  holder?: string;

  @IsOptional()
  @IsEnum(PolicyStatusFilter)
  status?: PolicyStatusFilter;

  @IsOptional()
  @IsEnum(PolicyTypeFilter)
  type?: PolicyTypeFilter;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
