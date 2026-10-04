import type { z } from "zod";
import { AppError } from "./errors.js";

type RequestPart = "body" | "params" | "query";

export function parse<T extends z.ZodType>(schema: T, data: unknown, part: RequestPart = "body"): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(400, `invalid_${part}`, `Missing or invalid fields in request ${part}`);
  }
  return result.data;
}
