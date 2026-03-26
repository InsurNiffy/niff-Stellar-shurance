import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminRoleGuard } from './guards/admin-role.guard';
import { AdminService } from './admin.service';
import { AuditService } from './audit.service';
import { ReindexDto } from './dto/reindex.dto';
import { AuditQueryDto } from './dto/audit-query.dto';
import { FeatureFlagDto } from './dto/feature-flag.dto';
import { PrivacyService, PrivacyRequestType } from '../maintenance/privacy.service';

class PrivacyRequestDto {
  @IsString() subjectWalletAddress!: string;
  @IsEnum(['ANONYMIZE', 'DELETE']) requestType!: PrivacyRequestType;
  @IsOptional() @IsString() notes?: string;
}

@ApiTags('admin')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly auditService: AuditService,
    private readonly privacyService: PrivacyService,
  ) {}

  /**
   * POST /admin/reindex
   *
   * Enqueues an async reindex job starting from the given ledger sequence.
   * Returns a jobId so operators can track progress via the queue dashboard.
   *
   * Requires: admin role + valid JWT.
   * Writes an immutable audit row with actor and full payload.
   */
  @Post('reindex')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Enqueue a ledger reindex job from a given ledger' })
  async reindex(@Body() dto: ReindexDto, @Req() req: Request) {
    const actor = (req.user as any)?.walletAddress ?? 'unknown';
    const jobId = await this.adminService.enqueueReindex(dto.fromLedger);
    await this.auditService.write({
      actor,
      action: 'reindex',
      payload: { fromLedger: dto.fromLedger, jobId },
      ipAddress: req.ip,
    });
    return { jobId, fromLedger: dto.fromLedger, status: 'queued' };
  }

  /**
   * GET /admin/audits
   *
   * Paginated read of the immutable admin audit log.
   * Requires: admin role + valid JWT.
   */
  @Get('audits')
  @ApiOperation({ summary: 'Paginated admin audit log' })
  async getAudits(@Query() query: AuditQueryDto) {
    return this.auditService.findAll(query.page, query.limit, query.action);
  }

  /**
   * GET /admin/feature-flags
   *
   * Lists all feature flags and their current state.
   */
  @Get('feature-flags')
  @ApiOperation({ summary: 'List all feature flags' })
  async listFeatureFlags() {
    return this.adminService.getFeatureFlags();
  }

  /**
   * PATCH /admin/feature-flags/:key
   *
   * Toggles a feature flag on or off.
   * Writes an immutable audit row with actor and full payload.
   *
   * Legal note: disabling flags that gate user-facing activity (e.g. claim
   * filing, policy creation) constitutes a staff-initiated pause of user
   * operations. Such actions must be authorised by a designated compliance
   * officer and are subject to applicable insurance-regulation obligations.
   * The audit row created here serves as the immutable record of that action.
   */
  /** POST /admin/privacy/requests — execute anonymization or deletion for a subject. */
  @Post('privacy/requests')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Submit a privacy request (anonymize or delete off-chain data)' })
  async submitPrivacyRequest(@Body() dto: PrivacyRequestDto, @Req() req: Request) {
    const actor = (req.user as any)?.walletAddress ?? 'unknown';
    return this.privacyService.handleRequest({
      subjectWalletAddress: dto.subjectWalletAddress,
      requestType: dto.requestType,
      requestedBy: actor,
      ipAddress: req.ip,
      notes: dto.notes,
    });
  }

  /** GET /admin/privacy/requests — list all privacy requests. */
  @Get('privacy/requests')
  @ApiOperation({ summary: 'List privacy requests' })
  async listPrivacyRequests(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.privacyService.listRequests(Number(page), Number(limit));
  }

  @Patch('feature-flags/:key')
  @ApiOperation({ summary: 'Set a feature flag value' })
  async setFeatureFlag(
    @Param('key') key: string,
    @Body() dto: FeatureFlagDto,
    @Req() req: Request,
  ) {
    const actor = (req.user as any)?.walletAddress ?? 'unknown';
    const flag = await this.adminService.setFeatureFlag(key, dto.enabled, dto.description, actor);
    await this.auditService.write({
      actor,
      action: 'feature_flag_update',
      payload: { key, enabled: dto.enabled, description: dto.description },
      ipAddress: req.ip,
    });
    return flag;
  }
}
