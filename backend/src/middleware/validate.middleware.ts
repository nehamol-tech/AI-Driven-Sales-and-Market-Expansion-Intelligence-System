import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny } from "zod";
import { BadRequestError } from "../lib/errors.js";

export interface ValidateSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Validates `req.body` / `req.query` / `req.params` against the given zod
 * schemas, replacing each with its parsed (and thus coerced/defaulted)
 * value. Throws a 400 BadRequestError with field-level details on failure.
 */
export function validate(schemas: ValidateSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query);
        Object.defineProperty(req, "query", { value: parsed, writable: true, configurable: true });
      }
      if (schemas.params) {
        const parsed = schemas.params.parse(req.params);
        Object.defineProperty(req, "params", { value: parsed, writable: true, configurable: true });
      }
      next();
    } catch (err) {
      const zodErr = err as { issues?: unknown };
      if (zodErr && Array.isArray(zodErr.issues)) {
        next(new BadRequestError("Validation failed", zodErr.issues));
        return;
      }
      next(err);
    }
  };
}
