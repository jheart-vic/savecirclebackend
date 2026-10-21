import { z } from "zod";

// An empty value in .env (KEY="") counts as not set.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

/** Cloudflare's published Turnstile test secrets (always pass, always fail, already spent). */
export const isTurnstileTestSecret = (secret: string) => /^[123]x0+AA$/.test(secret);

const envSchema = z
  .object({
    // No default: a missing value must stop startup, never quietly mean "development"
    // (development hands back sign-in codes and skips the real human check).
    NODE_ENV: z.enum(["development", "production", "test"]),
    FRONTEND_ORIGIN: z.url(),
    AUTH_SECRET: z.string().min(32),
    SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
    TERMII_BASE_URL: optional(z.url()),
    TERMII_API_KEY: optional(z.string()),
    TERMII_SENDER_ID: optional(z.string().min(3).max(11)),
    TERMII_CHANNEL: z.enum(["dnd", "generic"]).default("dnd"),
    OTP_DAILY_LIMIT: z.coerce.number().int().positive().default(500),
    TURNSTILE_SECRET_KEY: optional(z.string()),
  })
  .superRefine((env, ctx) => {
    const termiiSet = [env.TERMII_BASE_URL, env.TERMII_API_KEY, env.TERMII_SENDER_ID].filter(Boolean).length;
    if (termiiSet !== 3 && (termiiSet !== 0 || env.NODE_ENV === "production")) {
      ctx.addIssue({
        code: "custom",
        path: ["TERMII_API_KEY"],
        message: "set TERMII_BASE_URL, TERMII_API_KEY and TERMII_SENDER_ID together (required in production)",
      });
    }
    if (env.NODE_ENV === "production" && (!env.TURNSTILE_SECRET_KEY || isTurnstileTestSecret(env.TURNSTILE_SECRET_KEY))) {
      ctx.addIssue({
        code: "custom",
        path: ["TURNSTILE_SECRET_KEY"],
        message: "a real Turnstile secret is required in production (Cloudflare test secrets are refused)",
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  console.error(`Invalid environment configuration:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

export const config = parsed.data;
export const isProduction = config.NODE_ENV === "production";
