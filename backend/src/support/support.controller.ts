import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  MessageEvent,
  Param,
  Patch,
  Post,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Observable, map, merge, of } from 'rxjs';
import { SupportService } from './support.service';
import { TypingService } from './typing.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { CreateFaqItemDto, UpdateFaqItemDto, ReorderFaqItemsDto } from './dto/faq.dto';
import { SetTypingDto } from './dto/typing.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../admin/guards/admin-role.guard';

@ApiTags('Support')
@Controller('support')
export class SupportController {
  constructor(
    private readonly supportService: SupportService,
    private readonly typingService: TypingService,
  ) {}

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
   * GET /api/support/tickets/:id
   * Public ticket lookup (customer thread view).
   */
  @Get('tickets/:id')
  @ApiOperation({ summary: 'Get a support ticket by id' })
  @ApiResponse({ status: 200, description: 'Ticket found' })
  async getTicket(@Param('id') id: string) {
    return this.supportService.getTicket(id);
  }

  /**
   * GET /api/support/tickets/:id/typing
   * Snapshot of whether staff is currently composing a reply.
   */
  @Get('tickets/:id/typing')
  @ApiOperation({ summary: 'Get current staff typing indicator for a ticket' })
  async getTyping(@Param('id') id: string) {
    return this.typingService.getTyping(id);
  }

  /**
   * SSE /api/support/tickets/:id/events
   * Realtime typing-indicator channel for the ticket thread UI.
   */
  @Sse('tickets/:id/events')
  @ApiOperation({ summary: 'SSE stream for ticket typing updates' })
  ticketEvents(@Param('id') id: string): Observable<MessageEvent> {
    const subject = this.typingService.subscribe(id);
    const initial = of({
      data: this.typingService.getTyping(id),
    } as MessageEvent);
    const live = subject.pipe(map((payload) => ({ data: payload }) as MessageEvent));
    return merge(initial, live);
  }

  /**
   * POST /api/support/tickets/:id/typing
   * Staff heartbeat: set or clear the typing indicator (JWT admin).
   */
  @Post('tickets/:id/typing')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Set staff typing indicator (admin)' })
  async setTyping(@Param('id') id: string, @Body() dto: SetTypingDto) {
    // Ensure the ticket exists before publishing a signal.
    await this.supportService.getTicket(id);
    if (dto.isTyping) {
      return this.typingService.setTyping(id, dto.staffId ?? 'staff');
    }
    return this.typingService.clearTyping(id, 'explicit');
  }

  /**
   * DELETE /api/support/tickets/:id/typing
   * Clear typing (e.g. after sending a reply or navigating away).
   */
  @Delete('tickets/:id/typing')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Clear staff typing indicator (admin)' })
  async clearTyping(@Param('id') id: string) {
    return this.typingService.clearTyping(id, 'reply');
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

  // ── FAQ CRUD (admin-only) ────────────────────────────────────────────────

  /**
   * GET /api/support/faq
   * Public: list all FAQ entries ordered by displayOrder.
   */
  @Get('faq')
  @ApiOperation({ summary: 'List FAQ entries' })
  @ApiResponse({ status: 200, description: 'FAQ entries' })
  async listFaqItems() {
    return this.supportService.listFaqItems();
  }

  /**
   * POST /api/support/faq
   * Admin-only: create a new FAQ entry.
   */
  @Post('faq')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create FAQ entry (admin)' })
  @ApiResponse({ status: 201, description: 'FAQ entry created' })
  async createFaqItem(@Body() dto: CreateFaqItemDto) {
    return this.supportService.createFaqItem(dto);
  }

  /**
   * PATCH /api/support/faq/reorder
   * Admin-only: update displayOrder for multiple FAQ entries in one call.
   * Must come before `:id` route to avoid "reorder" being treated as an id.
   */
  @Patch('faq/reorder')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reorder FAQ entries (admin)' })
  async reorderFaqItems(@Body() dto: ReorderFaqItemsDto) {
    return this.supportService.reorderFaqItems(dto);
  }

  /**
   * PATCH /api/support/faq/:id
   * Admin-only: update question, answer, or category of an FAQ entry.
   */
  @Patch('faq/:id')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update FAQ entry (admin)' })
  async updateFaqItem(@Param('id') id: string, @Body() dto: UpdateFaqItemDto) {
    return this.supportService.updateFaqItem(id, dto);
  }

  /**
   * DELETE /api/support/faq/:id
   * Admin-only: delete an FAQ entry.
   */
  @Delete('faq/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete FAQ entry (admin)' })
  async deleteFaqItem(@Param('id') id: string) {
    await this.supportService.deleteFaqItem(id);
  }
}
