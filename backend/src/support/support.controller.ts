import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SupportService } from './support.service';
import { CreateTicketDto } from './dto/create-ticket.dto';

@ApiTags('Support')
@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  /**
   * POST /api/support/tickets
   * Submit a support ticket. CAPTCHA token required.
   * Rate-limited to 5 submissions per 10 minutes per IP.
   */
  @Post('tickets')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @ApiOperation({ summary: 'Submit a support ticket (CAPTCHA protected)' })
  @ApiResponse({ status: 201, description: 'Ticket received' })
  @ApiResponse({ status: 400, description: 'CAPTCHA failed or validation error' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async submitTicket(@Body() dto: CreateTicketDto, @Ip() ip: string) {
    return this.supportService.submitTicket(dto, ip);
  }

  /**
   * POST /api/support/faq/:faqId/expand
   * Privacy-safe FAQ expansion tracking.
   */
  @Post('faq/:faqId/expand')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Track FAQ entry expansion (privacy-safe)' })
  async trackExpansion(@Param('faqId') faqId: string) {
    await this.supportService.trackFaqExpansion(faqId);
  }
}
