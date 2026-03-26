import { Body, Controller, Post } from '@nestjs/common';
import { BetaCalculatorDto } from '../dto/beta-calculator.dto';
import { Feature } from '../feature-flags/feature.decorator';

@Controller('experimental/beta-calculators')
@Feature('experimental.betaCalculators')
export class BetaCalculatorsController {
  @Post('premium-preview')
  premiumPreview(@Body() body: BetaCalculatorDto) {
    return {
      premium: Number((body.basePremium * body.riskMultiplier).toFixed(2)),
    };
  }
}
