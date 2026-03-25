import { Request, Response, NextFunction } from "express";
import {
  getPoliciesList,
  getPolicySingle,
  CursorError,
} from "../services/policy.service";
import { PolicyFilter } from "../repositories/policy.repository";
import { DEFAULT_LIMIT, MAX_LIMIT } from "../helpers/pagination";

/**
 * GET /policies
 *
 * Query params:
 *   status  — "active" | "expired"  (omit for all)
 *   holder  — Stellar address string
 *   after   — opaque cursor from previous response
 *   limit   — integer 1–100 (default 20)
 */
export function listPolicies(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const filter: PolicyFilter = {};

    const { status, holder, after, limit: limitRaw } = req.query;

    if (status !== undefined) {
      if (status !== "active" && status !== "expired") {
        res.status(400).json({
          error: "invalid_filter",
          message: `"status" must be "active" or "expired".`,
        });
        return;
      }
      filter.status = status;
    }

    if (typeof holder === "string" && holder.length > 0) {
      filter.holder = holder;
    }

    let limit = DEFAULT_LIMIT;
    if (limitRaw !== undefined) {
      const parsed = parseInt(String(limitRaw), 10);
      if (!Number.isInteger(parsed) || parsed < 1) {
        res.status(400).json({
          error: "invalid_param",
          message: `"limit" must be a positive integer (max ${MAX_LIMIT}).`,
        });
        return;
      }
      limit = parsed;
    }

    const result = getPoliciesList(filter, {
      after: typeof after === "string" ? after : undefined,
      limit,
    });

    res.json(result);
  } catch (err) {
    if (err instanceof CursorError) {
      res.status(400).json({ error: "invalid_cursor", message: (err as Error).message });
      return;
    }
    next(err);
  }
}

/**
 * GET /policies/:holder/:policy_id
 *
 * Path params:
 *   holder    — URL-encoded Stellar address
 *   policy_id — per-holder u32 integer
 */
export function getPolicy(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const { holder, policy_id: pidRaw } = req.params;

    const policy_id = parseInt(pidRaw, 10);
    if (!Number.isInteger(policy_id) || policy_id < 1) {
      res.status(400).json({
        error: "invalid_param",
        message: `"policy_id" must be a positive integer.`,
      });
      return;
    }

    const result = getPolicySingle(decodeURIComponent(holder), policy_id);
    if (!result) {
      res.status(404).json({
        error: "not_found",
        message: `Policy (holder=${holder}, policy_id=${policy_id}) not found.`,
      });
      return;
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
}
