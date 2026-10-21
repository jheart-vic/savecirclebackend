import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { checkOrigin } from "./auth/auth.middleware.js";
import { authRouter } from "./auth/auth.routes.js";
import { config } from "./config.js";
import { errorHandler, notFoundHandler } from "./errors.js";

export const app = express();

// Render sits one proxy hop in front of the app; without this req.ip is the proxy.
app.set("trust proxy", 1);
app.use(cors({ origin: config.FRONTEND_ORIGIN, credentials: true }));
app.use(checkOrigin);
app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth", authRouter);

app.use(notFoundHandler);
app.use(errorHandler);
