import { z } from "zod";
import { calendarDate, todayInLagos } from "../groups/groups.validation.js";

export const reorderBody = z.object({ memberIds: z.array(z.uuid()).min(1).max(500) });

export const startBody = z.object({
  firstDueDate: calendarDate.refine((date) => date >= todayInLagos(), "cannot be in the past").optional(),
});
