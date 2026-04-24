import { Controller, Get, Headers, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Feature } from '../feature-flags/feature.decorator';
import { RAMP_FEATURE_FLAG } from './ramp.constants';

@Controller('ramp')
export class RampController {
  constructor(private readonly config: ConfigService) {}

  @Get('config')
  @Feature(RAMP_FEATURE_FLAG)
  getConfig(@Headers('x-region') region: string | undefined) {
    const allowedRegions = (this.config.get<string>('RAMP_ALLOWED_REGIONS') ?? '')
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);
    const normalised = (region ?? '').toUpperCase();

    if (allowedRegions.length > 0 && !allowedRegions.includes(normalised)) {
      throw new NotFoundException('Ramp not available in your region');
    }

    const baseUrl = this.config.get<string>('RAMP_URL') ?? '';
    const url = new URL(baseUrl);
    url.searchParams.set(
      'utm_source',
      this.config.get<string>('RAMP_UTM_SOURCE', 'niffyinsure'),
    );
    url.searchParams.set('utm_medium', this.config.get<string>('RAMP_UTM_MEDIUM', 'app'));
    url.searchParams.set(
      'utm_campaign',
      this.config.get<string>('RAMP_UTM_CAMPAIGN', 'onramp'),
    );

    return { url: url.toString() };
  }
}
