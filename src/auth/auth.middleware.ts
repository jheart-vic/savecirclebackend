import type { NextFunction, Request, RequestHandler, Response } from "express";
import { rateLimit } from "express-rate-limit";
import { config } from "../config.js";
import { AppError } from "../errors.js";
import { verifyHuman } from "../turnstile.js";
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

const TURNSTILE_TOKEN_MAX = 2048;

/** Requires a Cloudflare Turnstile token in `turnstileToken`; fails closed if Cloudflare is unreachable. */
export async function requireHuman(req: Request, _res: Response, next: NextFunction) {
  const token: unknown = req.body?.turnstileToken;
  if (typeof token !== "string" || token.length === 0 || token.length > TURNSTILE_TOKEN_MAX) {
    throw new AppError(400, "human_check_required", "Complete the human check and try again");
  }

  let passed: boolean;
  try {
    passed = await verifyHuman(token, req.ip ?? "unknown");
  } catch (error) {
    console.error(error);
    throw new AppError(503, "human_check_unavailable", "We couldn't run the human check. Try again shortly.");
  }

  if (!passed) {
    throw new AppError(403, "human_check_failed", "The human check failed or expired. Please try again.");
  }
  next();
}

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
