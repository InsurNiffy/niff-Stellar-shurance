import { Injectable } from "@nestjs/common";
import { EventEmitter } from "events";

export const RAMP_COMPLETED_EVENT = "ramp.completed";

export interface RampCompletedEvent {
  purchaseId: string;
  receiverAddress: string;
  cryptoAmount: string;
  cryptoCurrency: string;
  fiatValue: number;
  fiatCurrency: string;
  finalTxHash?: string;
}

/** In-process event bus for ramp lifecycle events (e.g. premium funding). */
@Injectable()
export class RampEvents extends EventEmitter {}
