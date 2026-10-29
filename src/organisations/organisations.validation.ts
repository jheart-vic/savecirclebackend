import { z } from "zod";
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
