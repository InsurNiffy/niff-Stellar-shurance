import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FEATURE_FLAGS_DISABLED_STATUS_ENV,
} from './constants';

type FeatureMap = Record<string, boolean>;

@Injectable()
export class FeatureFlagsService implements OnModuleInit {
  private readonly logger = new Logger(FeatureFlagsService.name);
  private featureMap: FeatureMap = {};
  private readonly disabledStatusCode: 403 | 404;

  constructor(private readonly config: ConfigService) {
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
      this.featureMap = flags.reduce<FeatureMap>((acc, flag) => {
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

  // Method to refresh flags after DB updates
  async refreshFlags(): Promise<void> {
    await this.loadFlagsFromDb();
  }
}
