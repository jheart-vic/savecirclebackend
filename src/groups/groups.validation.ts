import { z } from "zod";
import { Frequency, GroupType } from "../generated/prisma/enums.js";

// Standard, due-date only, and standard plus a 5-days-before nudge (project plan, reminders).
const REMINDER_SCHEDULES = [[-2, 0, 1], [0], [-5, -2, 0, 1]];
export const DEFAULT_REMINDER_OFFSETS = REMINDER_SCHEDULES[0];

const MAX_CONTRIBUTION_KOBO = 2_000_000_000;

/** Today's date in Nigeria as YYYY-MM-DD. */
export function todayInLagos(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(now);
}

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), "not a real date");

export const createGroupBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    type: z.enum(GroupType),
    contributionAmount: z.number().int().min(1).max(MAX_CONTRIBUTION_KOBO),
    frequency: z.enum(Frequency),
    startDate: calendarDate.optional(),
    reminderOffsets: z.array(z.number().int()).optional(),
  })
  .superRefine((group, ctx) => {
    if (group.type === "fixed" && !group.startDate) {
      ctx.addIssue({ code: "custom", path: ["startDate"], message: "required for thrift groups" });
    }
    if (group.type === "rotating" && group.startDate) {
      ctx.addIssue({ code: "custom", path: ["startDate"], message: "only for thrift groups" });
    }
    if (group.startDate && group.startDate < todayInLagos()) {
      ctx.addIssue({ code: "custom", path: ["startDate"], message: "cannot be in the past" });
    }
    const offsets = JSON.stringify(group.reminderOffsets ?? DEFAULT_REMINDER_OFFSETS);
    if (!REMINDER_SCHEDULES.some((schedule) => JSON.stringify(schedule) === offsets)) {
      ctx.addIssue({ code: "custom", path: ["reminderOffsets"], message: "not a supported schedule" });
    }
  });

export const groupParams = z.object({ groupId: z.uuid() });

export const officerParams = z.object({ groupId: z.uuid(), userId: z.uuid() });

export const assignOfficerBody = z.object({ userId: z.uuid() });

export const memberName = z.string().trim().min(1).max(100);

export const addMemberBody = z.object({ name: memberName, phone: z.string().max(32) });

export const MAX_IMPORT_ROWS = 500;
