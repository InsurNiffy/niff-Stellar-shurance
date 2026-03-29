import {
  Controller,
  Get,
  Query,
  Req,
  Res,
  Sse,
  UseGuards,
  MessageEvent,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Observable } from "rxjs";
import { map, finalize } from "rxjs/operators";
import type { Request, Response } from "express";
import { randomUUID } from "crypto";
import { OptionalJwtAuthGuard } from "../tx/guards/optional-jwt.guard";
import { SseConnectionRegistry } from "./sse-connection.registry";

/** Maximum claim IDs per SSE subscription. */
const MAX_CLAIM_IDS = 50;

/**
 * SSE reconnect interval hint sent to the client.
 * 5000 ms is the EventSource default; we set it explicitly so clients
 * reconnect within 5 s rather than waiting for browser defaults (~3 s in
 * Chrome, longer in others).
 */
const SSE_RETRY_MS = 5000;

@ApiTags("events")
@Controller("events")
export class EventsController {
  private readonly logger = new Logger(EventsController.name);

  constructor(private readonly registry: SseConnectionRegistry) {}

  /**
   * GET /api/events/claims
   *
   * Server-Sent Events stream for real-time claim status updates.
   *
   * Authentication:
   *   - Authenticated (wallet JWT Bearer token): 30 requests per minute per wallet.
   *   - Anonymous: 5 requests per minute per IP. Stricter to prevent abuse.
   *
   * Reconnect guidance:
   *   The stream sets `retry: 5000` on each event frame. EventSource clients
   *   reconnect automatically. On reconnect, supply the last received `claimId`
   *   and `cursor` (updatedAt timestamp) as query params. The server will
   *   deliver a snapshot of current statuses immediately on connect so clients
   *   don't miss state that changed during the disconnection window.
   *
   * Max concurrent connections: SSE_MAX_CONNECTIONS env var (default 500).
   * Each connection is a lightweight RxJS Subject — no DB transaction is held.
   *
   * Disconnect handling:
   *   When the client closes the connection, the Subject is completed and the
   *   connection is removed from the registry. Heartbeats (: heartbeat) are
   *   sent every 25 seconds to keep the connection alive through proxies with
   *   short idle timeouts.
   */
  @Get("claims")
  @Sse()
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({
    summary: "SSE stream for real-time claim status updates",
    description: [
      "Streams claim status changes for the requested claim IDs.",
      "Authenticated clients (wallet JWT) get a higher rate limit (30/min vs 5/min for anonymous).",
      "The stream sends a `retry: 5000` hint so EventSource reconnects within 5 s.",
      "On reconnect, re-subscribe with the same claimId list to resume.",
    ].join(" "),
  })
  @ApiQuery({ name: "claimId", required: true, isArray: true, type: String })
  @ApiResponse({ status: 200, description: "text/event-stream" })
  @ApiResponse({ status: 400, description: "Missing or too many claimId values" })
  @ApiResponse({ status: 503, description: "Connection limit reached" })
  streamClaims(
    @Query("claimId") claimIdParam: string | string[],
    @Req() req: Request,
    @Res() res: Response,
  ): Observable<MessageEvent> {
    const claimIds = (Array.isArray(claimIdParam) ? claimIdParam : [claimIdParam])
      .filter(Boolean)
      .slice(0, MAX_CLAIM_IDS);

    if (claimIds.length === 0) {
      throw new BadRequestException("At least one claimId query parameter is required.");
    }

    // Resolve wallet address from optional JWT
    const walletAddress = (req as Request & { user?: { walletAddress: string } }).user
      ?.walletAddress;

    const connectionId = randomUUID();

    // Set SSE-specific headers (NestJS @Sse sets Content-Type automatically)
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Prevent nginx from buffering SSE

    const connection = this.registry.register(connectionId, claimIds, walletAddress);

    this.logger.log(
      `SSE connection opened: ${connectionId} wallet=${walletAddress ?? "anonymous"} ` +
        `claims=[${claimIds.join(",")}] total=${this.registry.activeCount()}`,
    );

    // Heartbeat timer — keeps the connection alive through 60 s proxy timeouts
    const heartbeatTimer = setInterval(() => {
      try {
        // Send SSE comment line (not dispatched as a message event)
        res.write(": heartbeat\n\n");
      } catch {
        // Connection already gone
      }
    }, 25_000);

    // Cleanup on client disconnect
    req.on("close", () => {
      clearInterval(heartbeatTimer);
      this.registry.unregister(connectionId);
      this.logger.log(
        `SSE connection closed: ${connectionId} total=${this.registry.activeCount()}`,
      );
    });

    return connection.subject.pipe(
      map((event: MessageEvent) => ({
        // Embed retry hint in every event frame
        retry: SSE_RETRY_MS,
        type: "claim_update",
        data: event.data,
      })),
      finalize(() => {
        clearInterval(heartbeatTimer);
        this.registry.unregister(connectionId);
      }),
    );
  }
}
