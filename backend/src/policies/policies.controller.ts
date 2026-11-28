import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { PoliciesService } from './policies.service';
import { BuildPolicyTransactionDto } from './dto/build-policy-transaction.dto';
import { ListPoliciesQueryDto } from './dto/list-policies-query.dto';

@Controller('policies')
@UseGuards(OptionalJwtAuthGuard)
export class PoliciesController {
  constructor(private readonly policiesService: PoliciesService) {}

  @Get()
  async list(@Query() query: ListPoliciesQueryDto, @Req() req: any) {
    return this.policiesService.list({
      holder: query.holder,
      status: query.status,
      type: query.type,
      cursor: query.cursor,
      limit: query.limit,
      tenantId: req.user?.tenantId,
      authenticated: Boolean(req.user),
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: any) {
    return this.policiesService.findOne(id, {
      tenantId: req.user?.tenantId,
      authenticated: Boolean(req.user),
    });
  }

  @Get(':id/claims')
  async claims(@Param('id') id: string, @Req() req: any) {
    return this.policiesService.findClaims(id, {
      tenantId: req.user?.tenantId,
      authenticated: Boolean(req.user),
    });
  }

  @Post('build-transaction')
  async buildTransaction(@Body() dto: BuildPolicyTransactionDto, @Req() req: any) {
    return this.policiesService.buildInitiatePolicyTransaction(dto, {
      tenantId: req.user?.tenantId,
      authenticated: Boolean(req.user),
    });
  }
}
