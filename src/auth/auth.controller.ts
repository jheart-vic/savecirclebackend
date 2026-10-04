import type { Request, Response } from "express";
import { parse } from "../validate.js";
import { clearSessionCookie, setSessionCookie } from "./auth.cookies.js";
import { currentAuth } from "./auth.middleware.js";
import * as authService from "./auth.service.js";
import { requirePhone, sessionParams, signInBody, signUpBody, verifyBody } from "./auth.validation.js";

const clientIp = (req: Request) => req.ip ?? "unknown";

export async function signUp(req: Request, res: Response) {
  const { name, phone } = parse(signUpBody, req.body);
  const { devCode } = await authService.requestCode({
    purpose: "sign_up",
    name,
    phoneNumber: requirePhone(phone),
    ip: clientIp(req),
  });
  res.status(202).json({ message: "We've sent a code to your phone", devCode });
}

export async function signIn(req: Request, res: Response) {
  const { phone } = parse(signInBody, req.body);
  const { devCode } = await authService.requestCode({
    purpose: "sign_in",
    phoneNumber: requirePhone(phone),
    ip: clientIp(req),
  });
  res.status(202).json({ message: "If this number has an account, we've sent a code", devCode });
}

export async function verify(req: Request, res: Response) {
  const { phone, code } = parse(verifyBody, req.body);
  const { user, token, expiresAt } = await authService.verifyCode({
    phoneNumber: requirePhone(phone),
    code,
    ip: clientIp(req),
  });
  setSessionCookie(res, token, expiresAt);
  res.json({ user: { id: user.id, name: user.name, phoneNumber: user.phoneNumber } });
}

export function me(_req: Request, res: Response) {
  const { user, sessionId, expiresAt } = currentAuth(res);
  res.json({ user, session: { id: sessionId, expiresAt } });
}

export async function signOut(req: Request, res: Response) {
  await authService.signOut(currentAuth(res), clientIp(req));
  clearSessionCookie(res);
  res.status(204).end();
}

export async function listSessions(_req: Request, res: Response) {
  res.json({ sessions: await authService.listSessions(currentAuth(res)) });
}

export async function revokeSession(req: Request, res: Response) {
  const { id } = parse(sessionParams, req.params, "params");
  const auth = currentAuth(res);
  await authService.revokeSession(auth, id, clientIp(req));
  if (id === auth.sessionId) clearSessionCookie(res);
  res.status(204).end();
}
