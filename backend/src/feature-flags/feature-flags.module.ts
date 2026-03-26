import { Module } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';
import { FeatureFlagsGuard } from './feature-flags.guard';
import { FeatureFlagsBootstrap } from './feature-flags.bootstrap';

@Module({
  providers: [FeatureFlagsService, FeatureFlagsGuard, FeatureFlagsBootstrap],
  exports: [FeatureFlagsService, FeatureFlagsGuard],
})
export class FeatureFlagsModule {}
