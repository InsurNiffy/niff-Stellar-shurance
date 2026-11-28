import { Body, Controller, Get, NotFoundException, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuditLog } from '../audit/audit-log.decorator';
import { ALLOWED_FLAG_KEYS, FeatureFlagsService } from './feature-flags.service';
import { UpdateFeatureFlagDto } from './dto/update-feature-flag.dto';

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

/**
 * Admin write surface for feature flags.
 *
 * Guarded by role and audit-logged; the service refreshes its in-memory cache
 * on update so toggles take effect without a restart.
 */
@ApiTags('admin-feature-flags')
@Controller('admin/feature-flags')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminFeatureFlagsController {
  constructor(private readonly featureFlagsService: FeatureFlagsService) {}

  @Patch(':key')
  @AuditLog('feature-flag.update')
  @ApiOperation({ summary: 'Update the enabled state of a feature flag' })
  @ApiResponse({ status: 200, description: 'Updated flag key and its enabled state' })
  @ApiResponse({ status: 404, description: 'Unknown feature flag key' })
  async updateFlag(
    @Param('key') key: string,
    @Body() dto: UpdateFeatureFlagDto,
  ): Promise<{ key: string; enabled: boolean }> {
    const flag = await this.featureFlagsService.setEnabled(key, dto.enabled);
    return { key: flag.key, enabled: flag.enabled };
  }
}
