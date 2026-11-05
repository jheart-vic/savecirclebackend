import { z } from "zod";

const MAX_PAYMENT_KOBO = 2_000_000_000;

export const memberParams = z.object({ groupId: z.uuid(), memberId: z.uuid() });

// A blank note (or one that is only spaces) means no note.
export const logCashBody = z.object({
  amount: z.number().int().min(1).max(MAX_PAYMENT_KOBO),
  note: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(200).optional(),
  ),
});
