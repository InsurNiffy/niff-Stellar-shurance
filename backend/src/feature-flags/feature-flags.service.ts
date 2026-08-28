import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  FEATURE_FLAGS_DISABLED_STATUS_ENV,
  FEATURE_FLAGS_JSON_ENV,
} from './constants';

type FeatureMap = Record<string, boolean>;

/** Predefined allowlist — only these keys may be created or toggled via the API. */
export const ALLOWED_FLAG_KEYS = new Set([
  'claims_enabled',
  'claims_appeal_enabled',
  'policy_creation_enabled',
  'voting_enabled',
  'ramp_enabled',
  'graphql_enabled',
  'tenant_resolution',
  'maintenance_mode',
  'ipfs_upload_enabled',
  'quote_simulation_cache_enabled',
  'experimental_beta_calculators',
  'ENABLE_DEV_TOOLS',
]);

@Injectable()
export class FeatureFlagsService implements OnModuleInit {
  private readonly logger = new Logger(FeatureFlagsService.name);
  private featureMap: FeatureMap = {};
  private readonly disabledStatusCode: 403 | 404;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.featureMap = this.parseFlags(this.config.get<string>(FEATURE_FLAGS_JSON_ENV));
    this.disabledStatusCode =
      this.config.get<string>(FEATURE_FLAGS_DISABLED_STATUS_ENV) === '403' ? 403 : 404;
  }

  async onModuleInit() {
    await this.loadFlagsFromDb();
  }

  async loadFlagsFromDb(): Promise<void> {
    try {
      const flags = await this.prisma.featureFlag.findMany();
      this.featureMap = flags.reduce<FeatureMap>((acc: FeatureMap, flag: { key: string; enabled: boolean }) => {
        acc[flag.key] = flag.enabled;
        return acc;
      }, {});
      this.logger.log(`Loaded ${flags.length} feature flags from database`);
    } catch (error) {
      this.logger.error(`Failed to load feature flags from database: ${error}`);
      this.featureMap = {};
    }
  }

  isEnabled(featureName: string): boolean {
    return this.featureMap[featureName] === true;
  }

  getDisabledStatusCode(): 403 | 404 {
    return this.disabledStatusCode;
  }

  getFlags(): FeatureMap {
    return { ...this.featureMap };
  }

  async refreshFlags(): Promise<void> {
    await this.loadFlagsFromDb();
    // Propagate to in-memory cache immediately (within same process)
    this.logger.log('Feature flags propagated to in-memory cache');
  }

  /** Validate key against allowlist. Throws BadRequestException if not allowed. */
  assertAllowlisted(key: string): void {
    if (!ALLOWED_FLAG_KEYS.has(key)) {
      throw new BadRequestException(
        `Flag key "${key}" is not in the allowlist. Allowed keys: ${[...ALLOWED_FLAG_KEYS].join(', ')}`,
      );
    }
  }

  private parseFlags(json: string | undefined): FeatureMap {
    if (!json) return {};
    try {
      const parsed: unknown = JSON.parse(json);
      if (typeof parsed !== 'object' || parsed === null) return {};
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, Boolean(v)]),
      );
    } catch {
      this.logger.warn(`Failed to parse ${FEATURE_FLAGS_JSON_ENV}: invalid JSON`);
      return {};
    }
  }
}
