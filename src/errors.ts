import type { ErrorRequestHandler, RequestHandler } from "express";

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, "not_found", "Route not found"));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }

  // body-parser marks malformed JSON with type "entity.parse.failed".
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "invalid_body", message: "Request body is not valid JSON" } });
    return;
  }

  console.error(err);
  res.status(500).json({ error: { code: "internal_error", message: "Something went wrong" } });
};
