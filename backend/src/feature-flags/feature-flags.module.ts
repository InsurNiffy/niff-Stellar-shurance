import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Module,
  NotFoundException,
  OnModuleInit,
  Param,
  Patch,
  Body,
  ForbiddenException,
  UseGuards,
  SetMetadata,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/**
 * Feature flags module (B-20).
 *
 * Flags are stored in the `feature_flags` table and cached in memory. The
 * service loads flags on `onModuleInit` and refreshes the cache whenever an
 * admin updates a flag, so toggles take effect without a restart.
 */

const PUBLIC_ALLOWLIST = ['new-dashboard', 'beta-search'] as const;

const FEATURE_FLAG_KEY = 'feature_flag_key';
const FEATURE_FLAG_STATUS = 'feature_flag_status';

export const RequireFeatureFlag = (key: string, status: 403 | 404 = 403) =>
  (target: any, propertyKey?: string, descriptor?: PropertyDescriptor) => {
    SetMetadata(FEATURE_FLAG_KEY, key)(target, propertyKey as string, descriptor as any);
    SetMetadata(FEATURE_FLAG_STATUS, status)(target, propertyKey as string, descriptor as any);
  };

export interface FeatureFlagRecord {
  key: string;
  enabled: boolean;
  status: 403 | 404;
}

/** Minimal DB abstraction; swap for the real repository/ORM in wiring. */
export interface FeatureFlagsRepository {
  findAll(): Promise<FeatureFlagRecord[]>;
  findByKey(key: string): Promise<FeatureFlagRecord | null>;
  update(key: string, enabled: boolean): Promise<FeatureFlagRecord>;
}

@Injectable()
export class FeatureFlagsService implements OnModuleInit {
  private readonly logger = new Logger(FeatureFlagsService.name);
  private cache = new Map<string, FeatureFlagRecord>();

  constructor(private readonly repository: FeatureFlagsRepository) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const flags = await this.repository.findAll();
    this.cache = new Map(flags.map((flag) => [flag.key, flag]));
    this.logger.log(`Loaded ${this.cache.size} feature flag(s)`);
  }

  isEnabled(key: string): boolean {
    return this.cache.get(key)?.enabled ?? false;
  }

  getStatus(key: string): 403 | 404 {
    return this.cache.get(key)?.status ?? 404;
  }

  getPublicFlag(key: string): FeatureFlagRecord {
    if (!(PUBLIC_ALLOWLIST as readonly string[]).includes(key)) {
      throw new NotFoundException(`Feature flag '${key}' not found`);
    }
    const flag = this.cache.get(key);
    if (!flag) {
      throw new NotFoundException(`Feature flag '${key}' not found`);
    }
    return flag;
  }

  async update(key: string, enabled: boolean): Promise<FeatureFlagRecord> {
    const updated = await this.repository.update(key, enabled);
    this.cache.set(updated.key, updated);
    return updated;
  }
}

@Injectable()
export class FeatureFlagsGuard implements CanActivate {
  constructor(
    private readonly service: FeatureFlagsService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const key = this.reflector.getAllAndOverride<string>(FEATURE_FLAG_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!key) {
      return true;
    }
    if (this.service.isEnabled(key)) {
      return true;
    }
    const status = this.reflector.getAllAndOverride<403 | 404>(FEATURE_FLAG_STATUS, [
      context.getHandler(),
      context.getClass(),
    ]) ?? this.service.getStatus(key);
    if (status === 404) {
      throw new NotFoundException(`Feature '${key}' not found`);
    }
    throw new ForbiddenException(`Feature '${key}' is disabled`);
  }
}

@Controller('api/feature-flags')
export class FeatureFlagsController {
  constructor(private readonly service: FeatureFlagsService) {}

  @Get(':key')
  getFlag(@Param('key') key: string): FeatureFlagRecord {
    return this.service.getPublicFlag(key);
  }
}

@Controller('admin/feature-flags')
export class FeatureFlagsAdminController {
  private readonly logger = new Logger(FeatureFlagsAdminController.name);

  constructor(private readonly service: FeatureFlagsService) {}

  @Patch(':key')
  async updateFlag(
    @Param('key') key: string,
    @Body('enabled') enabled: boolean,
  ): Promise<FeatureFlagRecord> {
    const updated = await this.service.update(key, enabled);
    this.logger.log(`Feature flag '${key}' set to ${enabled}`);
    return updated;
  }
}

@Module({
  controllers: [FeatureFlagsController, FeatureFlagsAdminController],
  providers: [FeatureFlagsService, FeatureFlagsGuard],
  exports: [FeatureFlagsService, FeatureFlagsGuard],
})
export class FeatureFlagsModule {}
