import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import {
  RAMP_COMPLETED_EVENT,
  RampCompletedEvent,
  RampEvents,
} from "./ramp.events";

export interface RampQuoteRequest {
  fiatCurrency: string;
  fiatValue: number;
  cryptoCurrency: string;
}

export interface RampInitiateRequest extends RampQuoteRequest {
  receiverAddress: string;
}

/**
 * Fiat ramp integration for paying policy premiums in fiat currency.
 * Quotes are fetched from the provider; initiated purchases are tracked in
 * `RampTransaction` until the provider webhook confirms funding.
 */
@Injectable()
export class RampPremiumService {
  private readonly logger = new Logger(RampPremiumService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly events: RampEvents,
  ) {}

  async quote(req: RampQuoteRequest): Promise<unknown> {
    this.validate(req);
    const apiUrl = this.config.get<string>("RAMP_API_URL");
    if (!apiUrl) {
      throw new BadRequestException("Ramp provider is not configured");
    }

    const res = await fetch(`${apiUrl.replace(/\/$/, "")}/quote`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.config.get<string>("RAMP_API_KEY")
          ? {
              authorization: `Bearer ${this.config.get<string>("RAMP_API_KEY")}`,
            }
          : {}),
      },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      this.logger.warn(`Ramp quote failed: status=${res.status}`);
      throw new BadGatewayException("Ramp provider quote failed");
    }
    return res.json();
  }

  async initiate(
    req: RampInitiateRequest,
  ): Promise<{ purchaseId: string; widgetUrl: string; status: string }> {
    this.validate(req);
    if (!/^G[A-Z2-7]{55}$/.test(req.receiverAddress ?? "")) {
      throw new BadRequestException(
        "receiverAddress must be a valid Stellar public key",
      );
    }
    const baseUrl = this.config.get<string>("RAMP_URL");
    if (!baseUrl) {
      throw new BadRequestException("Ramp provider is not configured");
    }

    const purchaseId = randomUUID();
    await this.prisma.rampTransaction.create({
      data: {
        purchaseId,
        status: "PENDING",
        receiverAddress: req.receiverAddress,
        cryptoAmount: "0",
        cryptoCurrency: req.cryptoCurrency,
        fiatValue: req.fiatValue,
        fiatCurrency: req.fiatCurrency,
        lastSyncedAt: new Date(),
      },
    });

    const url = new URL(baseUrl);
    url.searchParams.set("userAddress", req.receiverAddress);
    url.searchParams.set("swapAsset", req.cryptoCurrency);
    url.searchParams.set("fiatCurrency", req.fiatCurrency);
    url.searchParams.set("fiatValue", String(req.fiatValue));
    url.searchParams.set("hostTxId", purchaseId);

    return { purchaseId, widgetUrl: url.toString(), status: "PENDING" };
  }

  /** Persist a provider status update; emits `ramp.completed` on successful funding. */
  async recordStatus(
    purchase: RampCompletedEvent & { status: string },
  ): Promise<void> {
    const data = {
      status: purchase.status,
      receiverAddress: purchase.receiverAddress,
      cryptoAmount: purchase.cryptoAmount,
      cryptoCurrency: purchase.cryptoCurrency,
      fiatValue: purchase.fiatValue,
      fiatCurrency: purchase.fiatCurrency,
      finalTxHash: purchase.finalTxHash ?? null,
      lastSyncedAt: new Date(),
    };
    const existing = await this.prisma.rampTransaction.findUnique({
      where: { purchaseId: purchase.purchaseId },
    });
    await this.prisma.rampTransaction.upsert({
      where: { purchaseId: purchase.purchaseId },
      create: { purchaseId: purchase.purchaseId, ...data },
      update: data,
    });

    if (purchase.status === "COMPLETE" && existing?.status !== "COMPLETE") {
      const { status: _status, ...event } = purchase;
      this.events.emit(RAMP_COMPLETED_EVENT, event);
    }
  }

  private validate(req: RampQuoteRequest): void {
    if (
      !req?.fiatCurrency ||
      !req.cryptoCurrency ||
      !(Number(req.fiatValue) > 0)
    ) {
      throw new BadRequestException(
        "fiatCurrency, cryptoCurrency and a positive fiatValue are required",
      );
    }
  }
}
