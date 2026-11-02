import { z } from "zod";

// Owner is never assignable: it belongs only to the organisation's creator.
export const ASSIGNABLE_ROLES = ["admin", "treasurer", "branch_manager", "field_officer"] as const;

export const createInviteBody = z.object({
  phone: z.string().max(32),
  role: z.enum(ASSIGNABLE_ROLES),
});

export const inviteParams = z.object({ inviteId: z.uuid() });

export const changeRoleBody = z.object({ role: z.enum(ASSIGNABLE_ROLES) });

export const staffParams = z.object({ membershipId: z.uuid() });
