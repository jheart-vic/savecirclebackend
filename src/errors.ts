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

const BODY_ERROR_MESSAGES: Record<string, string> = {
  "entity.parse.failed": "Request body is not valid JSON",
  "entity.too.large": "Request body is too large",
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }

  // body-parser rejects bad bodies (malformed JSON, too large, unsupported charset) with
  // `expose: true` and its own 4xx status.
  if (err?.expose === true && err.status >= 400 && err.status < 500) {
    const message = BODY_ERROR_MESSAGES[err.type] ?? "Request body could not be read";
    res.status(err.status).json({ error: { code: "invalid_body", message } });
    return;
  }

  console.error(err);
  res.status(500).json({ error: { code: "internal_error", message: "Something went wrong" } });
};
