import { Router } from "express";
import * as authController from "./auth.controller.js";
import { otpIpLimiter, requireAuth } from "./auth.middleware.js";

export const authRouter = Router();

authRouter.post("/sign-up", otpIpLimiter, authController.signUp);
authRouter.post("/sign-in", otpIpLimiter, authController.signIn);
authRouter.post("/verify", otpIpLimiter, authController.verify);
authRouter.get("/me", requireAuth, authController.me);
authRouter.post("/sign-out", requireAuth, authController.signOut);
authRouter.get("/sessions", requireAuth, authController.listSessions);
authRouter.delete("/sessions/:id", requireAuth, authController.revokeSession);
