import { Controller, Post, Body, HttpCode, HttpStatus, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { QuoteService } from './quote.service';
import { GeneratePremiumDto } from './dto/generate-premium.dto';

function cacheControlRequestsNoCache(cacheControl: string | undefined): boolean {
  if (!cacheControl) return false;
  return cacheControl
    .toLowerCase()
    .split(',')
    .some((d) => d.trim() === 'no-cache');
}

@ApiTags('Quote')
@Controller('quote')
export class QuoteController {
  constructor(private readonly quoteService: QuoteService) {}

  /**
   * POST /api/quote/generate-premium
   *
   * Returns the annual premium for the given risk profile.
   * Invalid payloads are rejected before any RPC call is made.
   * source="local_fallback" when contract is not deployed or source_account is omitted.
   */
  @Post('generate-premium')
  @HttpCode(HttpStatus.OK)
  // Simulation is CPU/RPC-expensive: 20 req / 60 s per identity
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Simulate annual premium for a proposed policy' })
  @ApiHeader({
    name: 'Cache-Control',
    required: false,
    description: 'Send `no-cache` to bypass the quote simulation Redis cache.',
  })
  @ApiResponse({ status: 200, description: 'Premium quote' })
  @ApiResponse({ status: 400, description: 'Validation error or account not found' })
  async generatePremium(
    @Body() dto: GeneratePremiumDto,
    @Headers('cache-control') cacheControl?: string,
  ) {
    return this.quoteService.getQuote(dto, {
      bypassCache: cacheControlRequestsNoCache(cacheControl),
    });
  }
}
