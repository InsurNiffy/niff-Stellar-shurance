import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';

@Injectable()
export class FeatureFlagsBootstrap implements OnModuleInit {
  private readonly logger = new Logger(FeatureFlagsBootstrap.name);

  constructor(private readonly featureFlagsService: FeatureFlagsService) {}

  onModuleInit() {
    const flags = this.featureFlagsService.getFlags();
    this.logger.log(
      `Feature flags loaded at boot: ${Object.keys(flags).length} configured flag(s)`,
    );
  }
}
