/**
 * Simple in-memory rate limiter — no external dependencies.
 *
 * Strategy: sliding window per IP.
 * Limit: 60 requests / 60 seconds for public policy endpoints.
 *
 * For production, replace with a Redis-backed solution (e.g. rate-limiter-flexible).
 */

import { Request, Response, NextFunction } from "express";

interface WindowEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, WindowEntry>();
const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 60;

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

export function publicRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const ip = getClientIp(req);
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    store.set(ip, { count: 1, windowStart: now });
    res.setHeader("X-RateLimit-Limit", MAX_REQUESTS);
    res.setHeader("X-RateLimit-Remaining", MAX_REQUESTS - 1);
    next();
    return;
  }

  entry.count += 1;
  const remaining = Math.max(0, MAX_REQUESTS - entry.count);
  res.setHeader("X-RateLimit-Limit", MAX_REQUESTS);
  res.setHeader("X-RateLimit-Remaining", remaining);

  if (entry.count > MAX_REQUESTS) {
    const retryAfter = Math.ceil((WINDOW_MS - (now - entry.windowStart)) / 1000);
    res.setHeader("Retry-After", retryAfter);
    res.status(429).json({
      error: "rate_limit_exceeded",
      message: `Too many requests. Retry after ${retryAfter}s.`,
    });
    return;
  }

  next();
}
