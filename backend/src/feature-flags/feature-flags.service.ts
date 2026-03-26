import { Injectable, Logger } from '@nestjs/common';
import {
  FEATURE_FLAGS_DISABLED_STATUS_ENV,
  FEATURE_FLAGS_JSON_ENV,
} from './constants';

type FeatureMap = Record<string, boolean>;

@Injectable()
export class FeatureFlagsService {
  private readonly logger = new Logger(FeatureFlagsService.name);
  private readonly featureMap: FeatureMap;
  private readonly disabledStatusCode: 403 | 404;

  constructor() {
    this.featureMap = this.parseFlags(process.env[FEATURE_FLAGS_JSON_ENV]);
    this.disabledStatusCode =
      process.env[FEATURE_FLAGS_DISABLED_STATUS_ENV] === '403' ? 403 : 404;
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

  private parseFlags(rawValue: string | undefined): FeatureMap {
    if (!rawValue) {
      return {};
    }

    try {
      const parsed = JSON.parse(rawValue) as Record<string, unknown>;
      return Object.entries(parsed).reduce<FeatureMap>((acc, [key, value]) => {
        acc[key] = value === true;
        return acc;
      }, {});
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `${FEATURE_FLAGS_JSON_ENV} is not valid JSON; defaulting all features to disabled. ${details}`,
      );
      return {};
    }
  }
}
