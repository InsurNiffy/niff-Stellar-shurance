import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  NotFoundException,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { Feature } from '../feature-flags/feature.decorator';
import { RAMP_FEATURE_FLAG, RAMP_WEBHOOK_SECRET_HEADER } from './ramp.constants';
import { RampInitiateRequest, RampPremiumService, RampQuoteRequest } from './ramp-premium.service';

interface RampPurchaseCompletedPayload {
  type: 'PURCHASE_CREATED' | 'PURCHASE_FAILED' | 'PURCHASE_REFUNDED';
  purchase: {
    id: string;
    status: 'COMPLETE' | 'FAILED' | 'REFUNDED';
    finalTxHash?: string;
    receiverAddress: string;
    cryptoAmount: string;
    cryptoCurrency: string;
    fiatValue: number;
    fiatCurrency: string;
    purchaseViewToken?: string;
  };
}

interface RampInteractiveFlowDto {
  account?: string;
  assetCode?: string;
  amount?: string;
  region?: string;
}

interface RampInteractiveFlowResponse {
  transactionId: string;
  interactiveUrl: string;
  status: 'PENDING';
}

@Controller('ramp')
export class RampController {
  private readonly logger = new Logger(RampController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly premium: RampPremiumService,
  ) {}

  @Get('config')
  @Feature(RAMP_FEATURE_FLAG)
  getConfig(@Headers('x-region') region: string | undefined) {
    const allowedRegions = (this.config.get<string>('RAMP_ALLOWED_REGIONS') ?? '')
      .split(',')
      .map((v) => v.trim().toUpperCase())
      .filter(Boolean);
    const normalised = (region ?? '').toUpperCase();

    if (allowedRegions.length > 0 && !allowedRegions.includes(normalised)) {
      throw new NotFoundException('Ramp not available in your region');
    }

    const baseUrl = this.config.get<string>('RAMP_URL') ?? '';
    const url = new URL(baseUrl);
    url.searchParams.set('utm_source', this.config.get<string>('RAMP_UTM_SOURCE', 'niffyinsure'));
    url.searchParams.set('utm_medium', this.config.get<string>('RAMP_UTM_MEDIUM', 'app'));
    url.searchParams.set('utm_campaign', this.config.get<string>('RAMP_UTM_CAMPAIGN', 'onramp'));

    return { url: url.toString() };
  }

  /** Fetch a fiat -> crypto quote for paying a premium. */
  @Post('quote')
  @HttpCode(200)
  @Feature(RAMP_FEATURE_FLAG)
  quote(@Body() dto: RampQuoteRequest) {
    return this.premium.quote(dto);
  }

  /** Initiate a fiat premium payment; returns the provider widget URL. */
  @Post('initiate')
  @HttpCode(201)
  @Feature(RAMP_FEATURE_FLAG)
  initiate(@Body() dto: RampInitiateRequest) {
    return this.premium.initiate(dto);
  }

  /**
   * Start a SEP-24 interactive deposit (fiat -> crypto).
   * Returns the anchor's interactive URL for the client to open.
   */
  @Post('deposit')
  @HttpCode(201)
  @Feature(RAMP_FEATURE_FLAG)
  startDeposit(@Body() dto: RampInteractiveFlowDto): RampInteractiveFlowResponse {
    return this.startInteractiveFlow('deposit', dto);
  }

  /**
   * Start a SEP-24 interactive withdraw (crypto -> fiat).
   * Returns the anchor's interactive URL for the client to open.
   */
  @Post('withdraw')
  @HttpCode(201)
  @Feature(RAMP_FEATURE_FLAG)
  startWithdraw(@Body() dto: RampInteractiveFlowDto): RampInteractiveFlowResponse {
    return this.startInteractiveFlow('withdraw', dto);
  }

  /**
   * Ramp Network webhook endpoint.
   *
   * Security: HMAC-SHA256 signature verification using RAMP_WEBHOOK_SECRET.
   * Signature is in the `x-body-signature-sha256` header as a hex digest.
   *
   * Flow:
   *   PURCHASE_CREATED (status=COMPLETE) -> log successful payment
   *   PURCHASE_FAILED / PURCHASE_REFUNDED -> log failure, no orphaned policy
   */
  @Post('webhook')
  @HttpCode(200)
  @Feature(RAMP_FEATURE_FLAG)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers(RAMP_WEBHOOK_SECRET_HEADER) signature: string | undefined,
    @Body() payload: RampPurchaseCompletedPayload,
  ): Promise<{ received: boolean }> {
    this.verifySignature(req.rawBody, signature);

    const { type, purchase } = payload;

    if (!purchase?.id || !type) {
      throw new BadRequestException('Invalid Ramp webhook payload');
    }

    await this.premium.recordStatus({
      purchaseId: purchase.id,
      status: purchase.status,
      receiverAddress: purchase.receiverAddress,
      cryptoAmount: purchase.cryptoAmount,
      cryptoCurrency: purchase.cryptoCurrency,
      fiatValue: purchase.fiatValue,
      fiatCurrency: purchase.fiatCurrency,
      finalTxHash: purchase.finalTxHash,
    });

    switch (type) {
      case 'PURCHASE_CREATED':
        if (purchase.status === 'COMPLETE') {
          this.logger.log(
            `Ramp payment confirmed: purchaseId=${purchase.id} ` +
            `receiver=${purchase.receiverAddress} ` +
            `amount=${purchase.cryptoAmount} ${purchase.cryptoCurrency}`,
          );
        }
        break;
      case 'PURCHASE_FAILED':
        this.logger.warn(`Ramp payment failed: purchaseId=${purchase.id} receiver=${purchase.receiverAddress}`);
        break;
      case 'PURCHASE_REFUNDED':
        this.logger.warn(`Ramp payment refunded: purchaseId=${purchase.id} receiver=${purchase.receiverAddress}`);
        break;
      default:
        this.logger.debug(`Ramp webhook: unhandled event type=${type}`);
    }

    return { received: true };
  }

  private startInteractiveFlow(
    kind: 'deposit' | 'withdraw',
    dto: RampInteractiveFlowDto,
  ): RampInteractiveFlowResponse {
    const region = (dto.region ?? '').toUpperCase();
    const allowedRegions = (this.config.get<string>('RAMP_ALLOWED_REGIONS') ?? '')
      .split(',')
      .map((v) => v.trim().toUpperCase())
      .filter(Boolean);

    if (allowedRegions.length > 0 && !allowedRegions.includes(region)) {
      throw new NotFoundException('Ramp not available in your region');
    }

    const baseUrl = this.config.get<string>('RAMP_URL');
    if (!baseUrl) {
      throw new BadRequestException('Ramp anchor is not configured');
    }

    const url = new URL(baseUrl);
    url.searchParams.set('flow', kind);
    if (dto.account) {
      url.searchParams.set('account', dto.account);
    }
    if (dto.assetCode) {
      url.searchParams.set('asset_code', dto.assetCode);
    }
    if (dto.amount) {
      url.searchParams.set('amount', dto.amount);
    }
    url.searchParams.set('utm_source', this.config.get<string>('RAMP_UTM_SOURCE', 'niffyinsure'));
    url.searchParams.set('utm_medium', this.config.get<string>('RAMP_UTM_MEDIUM', 'app'));
    url.searchParams.set('utm_campaign', kind === 'deposit' ? 'onramp' : 'offramp');

    const transactionId = `${kind}-${Date.now()}`;
    this.logger.log(`Ramp ${kind} started: transactionId=${transactionId} region=${region || 'n/a'}`);

    return { transactionId, interactiveUrl: url.toString(), status: 'PENDING' };
  }

  private verifySignature(rawBody: Buffer | undefined, signature: string | undefined): void {
    const secret = this.config.get<string>('RAMP_WEBHOOK_SECRET');
    if (!secret) {
      if (this.config.get<string>('NODE_ENV') !== 'development') {
        throw new UnauthorizedException('Ramp webhook secret not configured');
      }
      return;
    }

    if (!signature || !rawBody) {
      throw new UnauthorizedException('Missing Ramp webhook signature');
    }

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expected, 'hex');

    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      throw new UnauthorizedException('Invalid Ramp webhook signature');
    }
  }
}
