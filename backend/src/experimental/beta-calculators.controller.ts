import { Body, Controller, Post, UseInterceptors } from '@nestjs/common';
import { BetaCalculatorDto } from '../dto/beta-calculator.dto';
import { Feature } from '../feature-flags/feature.decorator';
import { DeprecatedApi } from '../common/versioning/deprecated-api.decorator';
import { ExperimentalAccessLogInterceptor } from './experimental-access-log.interceptor';

@DeprecatedApi()
@Controller('experimental/beta-calculators')
@Feature('experimental.betaCalculators')
@UseInterceptors(ExperimentalAccessLogInterceptor)
export class BetaCalculatorsController {
  @Post('premium-preview')
  premiumPreview(@Body() body: BetaCalculatorDto) {
    return {
      premium: Number((body.basePremium * body.riskMultiplier).toFixed(2)),
    };
  }
}
