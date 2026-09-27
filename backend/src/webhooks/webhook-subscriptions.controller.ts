import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WebhookSubscriptionsService } from './webhook-subscriptions.service';
import {
  CreateWebhookSubscriptionDto,
  UpdateWebhookSubscriptionDto,
} from './dto/webhook-subscription.dto';

@ApiTags('webhooks')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('webhooks/subscriptions')
export class WebhookSubscriptionsController {
  constructor(private readonly subscriptions: WebhookSubscriptionsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an outbound webhook subscription (tenant scoped)' })
  create(@Body() dto: CreateWebhookSubscriptionDto) {
    return this.subscriptions.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List webhook subscriptions' })
  list() {
    return this.subscriptions.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a webhook subscription' })
  get(@Param('id') id: string) {
    return this.subscriptions.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a webhook subscription' })
  update(@Param('id') id: string, @Body() dto: UpdateWebhookSubscriptionDto) {
    return this.subscriptions.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a webhook subscription' })
  remove(@Param('id') id: string) {
    return this.subscriptions.remove(id);
  }
}
