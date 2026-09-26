import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ALLOWED_FLAG_KEYS, FeatureFlagsService } from './feature-flags.service';

/**
 * Public, read-only view of a single feature flag.
 *
 * The admin API (`/admin/feature-flags`) owns writes; this endpoint exists so
 * the frontend `useFeatureFlag` hook can gate UI on the same key the backend
 * gates its endpoints with (see docs/feature-flag-naming-convention.md).
 *
 * Only allowlisted keys are readable, so the response never reveals internal
 * flag names that are not part of the shared contract.
 */
@ApiTags('feature-flags')
@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly featureFlagsService: FeatureFlagsService) {}

  @Get(':key')
  @ApiOperation({ summary: 'Read the enabled state of a single allowlisted feature flag' })
  @ApiResponse({ status: 200, description: 'Flag key and its current enabled state' })
  @ApiResponse({ status: 404, description: 'Unknown or non-allowlisted flag key' })
  getFlag(@Param('key') key: string): { key: string; enabled: boolean } {
    if (!ALLOWED_FLAG_KEYS.has(key)) {
      throw new NotFoundException(`Unknown feature flag: ${key}`);
    }
    return { key, enabled: this.featureFlagsService.isEnabled(key) };
  }
}
