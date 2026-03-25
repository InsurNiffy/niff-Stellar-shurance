import { Request, Response, NextFunction } from "express";
import { CursorError } from "../helpers/pagination";

export interface ApiError {
  error: string;
  message: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof CursorError) {
    res.status(400).json({ error: "invalid_cursor", message: err.message } satisfies ApiError);
    return;
  }
  console.error(err);
  res.status(500).json({ error: "internal_error", message: "An unexpected error occurred." } satisfies ApiError);
}
