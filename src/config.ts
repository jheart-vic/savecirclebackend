import { z } from "zod";

// An empty value in .env (KEY="") counts as not set.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    FRONTEND_ORIGIN: z.url(),
    AUTH_SECRET: z.string().min(32),
    SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
    TERMII_BASE_URL: optional(z.url()),
    TERMII_API_KEY: optional(z.string()),
    TERMII_SENDER_ID: optional(z.string().min(3).max(11)),
    TERMII_CHANNEL: z.enum(["dnd", "generic"]).default("dnd"),
    OTP_DAILY_LIMIT: z.coerce.number().int().positive().default(500),
  })
  .superRefine((env, ctx) => {
    const termiiSet = [env.TERMII_BASE_URL, env.TERMII_API_KEY, env.TERMII_SENDER_ID].filter(Boolean).length;
    if (termiiSet === 3 || (termiiSet === 0 && env.NODE_ENV !== "production")) return;
    ctx.addIssue({
      code: "custom",
      path: ["TERMII_API_KEY"],
      message: "set TERMII_BASE_URL, TERMII_API_KEY and TERMII_SENDER_ID together (required in production)",
    });
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  console.error(`Invalid environment configuration:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

export const config = parsed.data;
export const isProduction = config.NODE_ENV === "production";
