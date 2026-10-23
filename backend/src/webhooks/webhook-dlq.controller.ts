import { Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../admin/guards/admin-role.guard';
import { MinAdminRole } from '../admin/decorators/admin.decorator';
import { WebhookDlqService } from './webhook-dlq.service';

@ApiTags('admin')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
@Controller('admin/webhooks/dlq')
export class WebhookDlqController {
  constructor(private readonly dlq: WebhookDlqService) {}

  @Get()
  @MinAdminRole('viewer')
  @ApiOperation({ summary: 'List outbound webhook deliveries in the dead-letter queue' })
  list() {
    return this.dlq.list();
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually re-enqueue a dead-lettered webhook delivery' })
  retry(@Param('id') id: string) {
    return this.dlq.retry(id);
  }
}
