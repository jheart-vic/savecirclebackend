import { z } from "zod";
import { AppError } from "../errors.js";
import { normalizePhone } from "./phone.js";

const phone = z.string().max(32);

export const signUpBody = z.object({
  name: z.string().trim().min(1).max(100),
  phone,
});

export const signInBody = z.object({ phone });

export const verifyBody = z.object({
  phone,
  code: z.string().regex(/^\d{6}$/),
});

export const sessionParams = z.object({ id: z.uuid() });

export function requirePhone(phone: string): string {
  const phoneNumber = normalizePhone(phone);
  if (!phoneNumber) {
    throw new AppError(400, "invalid_phone", "Enter a valid Nigerian mobile number");
  }
  return phoneNumber;
}
