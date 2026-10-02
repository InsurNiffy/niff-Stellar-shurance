import {
  Controller,
  Get,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  HttpException,
  Logger,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Response } from "express";
import { HorizonService } from "./horizon.service";
import { HorizonTransactionResponse } from "./dto/horizon-transaction.dto";

/**
 * Horizon proxy controller.
 *
 * Routes (all under the global /api/v1 prefix via URI versioning):
 *   GET /v1/accounts/:address/transactions   — paginated operation history
 *   GET /v1/accounts/:address/balances       — account balances
 */
@Controller("accounts")
export class HorizonController {
  private readonly logger = new Logger(HorizonController.name);

  constructor(private readonly horizonService: HorizonService) {}

  /**
   * GET /v1/accounts/:address/transactions
   *
   * Cursor-paginated operation history for a Stellar account.
   * Filters to payment-relevant types and enriches with contract events.
   *
   * Query params:
   *   cursor  — paging_token from a previous response (optional)
   *   limit   — number of records to return, 1–200 (default 20)
   */
  @Get(":address/transactions")
  @HttpCode(HttpStatus.OK)
  async getTransactions(
    @Param("address") address: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limitStr?: string,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<HorizonTransactionResponse> {
    const limit = limitStr !== undefined ? parseInt(limitStr, 10) : 20;
    if (limitStr !== undefined && isNaN(limit)) {
      throw new HttpException("limit must be a number", HttpStatus.BAD_REQUEST);
    }

    const rl = await this.horizonService.checkRateLimit(address);
    if (!rl.allowed) {
      res?.setHeader("Retry-After", String(rl.retryAfterSeconds));
      throw new HttpException(
        {
          statusCode: 429,
          error: "Too Many Requests",
          message: "Rate limit exceeded for this account. Please slow down.",
          retryAfter: rl.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      return await this.horizonService.getTransactions(address, cursor, limit);
    } catch (err) {
      if (err instanceof ServiceUnavailableException) {
        const retryAfter = (err as ServiceUnavailableException & { retryAfter?: number }).retryAfter;
        if (retryAfter) {
          res?.setHeader("Retry-After", String(retryAfter));
        }
      }
      throw err;
    }
  }

  /**
   * GET /v1/accounts/:address/balances
   *
   * Returns the balances array for a Stellar account, extracted from the
   * Horizon account resource. Each element has:
   *   balance, asset_type, asset_code (if not native), asset_issuer (if not native)
   */
  @Get(":address/balances")
  @HttpCode(HttpStatus.OK)
  async getBalances(
    @Param("address") address: string,
  ): Promise<{ balances: unknown[] }> {
    return await this.horizonService.getBalances(address);
  }
}
