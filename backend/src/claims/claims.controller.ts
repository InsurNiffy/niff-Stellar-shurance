import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  Post,
  HttpCode,
  HttpStatus,
  Body,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { ClaimsService } from './claims.service';
import { ClaimsListResponseDto, ClaimDetailResponseDto } from './dto/claim.dto';
import { BuildClaimTransactionDto } from './dto/build-claim-transaction.dto';
import { SubmitTransactionDto } from './dto/submit-transaction.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletAddress } from '../auth/decorators/wallet-address.decorator';

@ApiTags('claims')
@Controller('claims')
export class ClaimsController {
  constructor(private readonly claimsService: ClaimsService) {}

  @Get()
  @ApiOperation({ summary: 'List all claims with aggregated data' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 20, max: 100)' })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'approved', 'rejected'], description: 'Filter by status' })
  @ApiResponse({ status: 200, description: 'Paginated list of claims', type: ClaimsListResponseDto })
  async listClaims(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('status') status?: string,
  ): Promise<ClaimsListResponseDto> {
    // Cap limit at 100
    const cappedLimit = Math.min(limit, 100);
    return this.claimsService.listClaims({ page, limit: cappedLimit, status });
  }

  @Get('needs-my-vote')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get claims requiring the authenticated user to vote' })
  @ApiResponse({ status: 200, description: 'Claims where user has not voted yet', type: ClaimsListResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getClaimsNeedingMyVote(
    @WalletAddress() walletAddress: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<ClaimsListResponseDto> {
    const cappedLimit = Math.min(limit, 100);
    return this.claimsService.getClaimsNeedingVote(walletAddress, { page, limit: cappedLimit });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get detailed claim view' })
  @ApiResponse({ status: 200, description: 'Detailed claim with vote tallies', type: ClaimDetailResponseDto })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  async getClaim(@Param('id', ParseIntPipe) id: number): Promise<ClaimDetailResponseDto> {
    return this.claimsService.getClaimById(id);
  }

  @Post('build-transaction')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Build unsigned file_claim transaction' })
  @ApiResponse({ status: 200, description: 'Unsigned transaction XDR + fee estimates' })
  async buildTransaction(@Body() dto: BuildClaimTransactionDto) {
    return this.claimsService.buildTransaction({
      holder: dto.holder,
      policyId: dto.policyId,
      amount: BigInt(dto.amount),
      details: dto.details,
      imageUrls: dto.imageUrls,
    });
  }

  @Post('submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit signed claim transaction' })
  @ApiResponse({ status: 200, description: 'Transaction submitted' })
  async submitTransaction(@Body() dto: SubmitTransactionDto) {
    return this.claimsService.submitTransaction(dto.transactionXdr);
  }
}
