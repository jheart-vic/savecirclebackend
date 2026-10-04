import type { CookieOptions, Response } from "express";
import { isProduction } from "../config.js";

export const SESSION_COOKIE = "sc_session";

const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  // The PWA is on another site in production, so the cookie must be sent cross-site.
  sameSite: isProduction ? "none" : "lax",
  path: "/",
};

export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: expiresAt.getTime() - Date.now() });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions);
}
