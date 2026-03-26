import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { FEATURE_METADATA_KEY } from './constants';
import { FeatureFlagsGuard } from './feature-flags.guard';

export function Feature(featureName: string) {
  return applyDecorators(
    SetMetadata(FEATURE_METADATA_KEY, featureName),
    UseGuards(FeatureFlagsGuard),
  );
}
