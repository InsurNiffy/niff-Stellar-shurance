import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { QuoteService } from './quote.service';
import { GeneratePremiumDto } from './dto/generate-premium.dto';

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
  @ApiOperation({ summary: 'Simulate annual premium for a proposed policy' })
  @ApiResponse({ status: 200, description: 'Premium quote' })
  @ApiResponse({ status: 400, description: 'Validation error or account not found' })
  async generatePremium(@Body() dto: GeneratePremiumDto) {
    return this.quoteService.getQuote(dto);
  }
}
