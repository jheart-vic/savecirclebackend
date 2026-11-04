import { z } from "zod";
import { config } from "../config.js";
import { OrganisationType } from "../generated/prisma/enums.js";

// A blank email (or one that is only spaces) means "not given".
const optionalEmail = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().toLowerCase().max(254).pipe(z.email()).optional(),
);

export const createOrganisationBody = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(OrganisationType),
  contactPhone: z.string().max(32),
  contactEmail: optionalEmail,
});

export const orgParams = z.object({ orgId: z.uuid() });

// A longer lifetime than the platform's would do nothing: the session itself expires first.
export const updatePolicyBody = z.object({
  sessionTtlDays: z.number().int().min(1).max(config.SESSION_TTL_DAYS),
});
