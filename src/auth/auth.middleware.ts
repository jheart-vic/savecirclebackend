import type { NextFunction, Request, RequestHandler, Response } from "express";
import { rateLimit } from "express-rate-limit";
import { config } from "../config.js";
import { AppError } from "../errors.js";
import { SESSION_COOKIE } from "./auth.cookies.js";
import * as authService from "./auth.service.js";

declare global {
  namespace Express {
    interface Locals {
      auth?: authService.AuthContext;
    }
  }
}

export const otpIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(new AppError(429, "too_many_requests", "Too many requests. Try again later."));
  },
});

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  res.locals.auth = await authService.authenticate(typeof token === "string" ? token : undefined);
  next();
}

/** The signed-in caller; only valid on routes behind requireAuth. */
export function currentAuth(res: Response): authService.AuthContext {
  if (!res.locals.auth) throw new Error("currentAuth used on a route without requireAuth");
  return res.locals.auth;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// The session cookie is sent cross-site in production, so a browser request that
// changes state must come from the frontend. Non-browser clients send no Origin.
export const checkOrigin: RequestHandler = (req, _res, next) => {
  const origin = req.get("origin");
  if (SAFE_METHODS.has(req.method) || !origin || origin === config.FRONTEND_ORIGIN) {
    next();
    return;
  }
  next(new AppError(403, "bad_origin", "Request origin is not allowed"));
};
