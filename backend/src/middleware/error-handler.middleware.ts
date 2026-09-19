import type { NextFunction, Request, Response } from "express";
import type { ApiErrorResponse } from "@ai-sales/shared";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { env } from "../config/env.js";

/**
 * Centralized error handler. Translates thrown `AppError`s (and unexpected
 * errors) into the shared `ApiErrorResponse` shape. Never leaks stack traces
 * or internal error messages when NODE_ENV==='production'.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    const body: ApiErrorResponse = {
      error: {
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    };
    if (err.statusCode >= 500) {
      logger.error(err.message, { stack: err.stack, path: req.path });
    }
    res.status(err.statusCode).json(body);
    return;
  }

  const error = err instanceof Error ? err : new Error("Unknown error");
  logger.error(error.message, { stack: error.stack, path: req.path });

  const body: ApiErrorResponse = {
    error: {
      message: env.NODE_ENV === "production" ? "Internal server error" : error.message,
      ...(env.NODE_ENV !== "production" ? { details: { stack: error.stack } } : {}),
    },
  };
  res.status(500).json(body);
}

export function notFoundHandler(req: Request, res: Response): void {
  const body: ApiErrorResponse = { error: { message: `Route not found: ${req.method} ${req.path}` } };
  res.status(404).json(body);
}
