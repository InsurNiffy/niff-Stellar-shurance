import { Module } from '@nestjs/common';
import { RampController } from './ramp.controller';
import { RampService } from './ramp.service';
import { RampPremiumService } from './ramp-premium.service';
import { RampEvents } from './ramp.events';
import { RampStatusPoller } from './ramp-status.poller';
import { RampProviderHealthJob } from './ramp-provider-health.job';
import { RampReconciliationJob } from './ramp-reconciliation.job';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';

@Module({
  imports: [FeatureFlagsModule],
  controllers: [RampController],
  providers: [RampService, RampPremiumService, RampEvents, RampStatusPoller, RampProviderHealthJob, RampReconciliationJob],
  exports: [RampService, RampEvents],
})
export class RampModule {}
