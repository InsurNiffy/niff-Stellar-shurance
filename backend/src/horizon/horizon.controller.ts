import {
  Controller,
  Get,
  Query,
  HttpCode,
  HttpStatus,
  HttpException,
  Logger,
} from "@nestjs/common";
import { HorizonService } from "./horizon.service";
import { HorizonRateLimitService } from "./horizon-rate-limit.service";
import { HorizonTransactionResponse } from "./dto/horizon-transaction.dto";

@Controller("horizon")
export class HorizonController {
  private readonly logger = new Logger(HorizonController.name);

  constructor(
    private readonly horizonService: HorizonService,
    private readonly rateLimitService: HorizonRateLimitService,
  ) {}

  /**
   * GET /api/horizon/transactions?account=<address>&cursor=<paging_token>&limit=<n>
   *
   * Proxies operation history from Horizon filtered to payment-relevant types.
   * API keys are never forwarded to the client in response headers or error bodies.
   *
   * Rate limited to 30 requests per 60 seconds per wallet address.
   */
  @Get("transactions")
  @HttpCode(HttpStatus.OK)
  async getTransactions(
    @Query("account") account: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limitStr?: string,
  ): Promise<HorizonTransactionResponse> {
    if (!account) {
      throw new HttpException(
        "account query parameter is required",
        HttpStatus.BAD_REQUEST,
      );
    }

    const limit = limitStr ? parseInt(limitStr, 10) : 20;
    if (isNaN(limit)) {
      throw new HttpException("limit must be a number", HttpStatus.BAD_REQUEST);
    }

    const rl = await this.rateLimitService.check(account);
    if (!rl.allowed) {
      throw new HttpException(
        {
          statusCode: 429,
          error: "Too Many Requests",
          message: "Rate limit exceeded for this account. Please slow down.",
          retryAfter: rl.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
        {
          // Retry-After header per RFC 7231
          headers: { "Retry-After": String(rl.retryAfterSeconds) },
        },
      );
    }

    return this.horizonService.getTransactions(account, cursor, limit);
  }
}
