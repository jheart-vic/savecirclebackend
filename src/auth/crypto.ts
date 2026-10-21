import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSecret(value: string): string {
  return createHmac("sha256", config.AUTH_SECRET).update(value).digest("hex");
}

export function secretsMatch(hashA: string, hashB: string): boolean {
  const a = Buffer.from(hashA, "hex");
  const b = Buffer.from(hashB, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
