import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FEATURE_METADATA_KEY } from './constants';
import { FeatureFlagsService } from './feature-flags.service';

@Injectable()
export class FeatureFlagsGuard implements CanActivate {
  private readonly logger = new Logger(FeatureFlagsGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly featureFlagsService: FeatureFlagsService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const featureName = this.reflector.getAllAndOverride<string>(
      FEATURE_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!featureName) {
      return true;
    }

    const flag = this.featureFlagsService.getFlag(featureName);

    if (flag && flag.enabled) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    this.logger.warn(
      `Blocked disabled feature access feature=${featureName} method=${request.method} path=${request.url} ip=${request.ip}`,
    );

    const statusCode = flag
      ? flag.disabledStatusCode
      : this.featureFlagsService.getDisabledStatusCode();

    if (statusCode === 403) {
      throw new ForbiddenException('Feature disabled');
    }

    throw new NotFoundException('Feature disabled');
  }
}
