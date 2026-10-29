import { prisma, type Db } from "./db.js";

// Both helpers set the RLS values with set_config(..., true), which lasts only until the
// transaction ends. That is required with Neon's pooler, where a plain SET could leak to
// another request sharing the same connection.

/** Runs `fn` in one transaction where row-level security sees `userId` and no organisation. */
export function withUser<T>(userId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  });
}

/**
 * Runs `fn` in one transaction scoped to `orgId`. Callers must already have checked that
 * `userId` is an active member of `orgId` (see `requireOrgMember`).
 */
export function withOrg<T>(orgId: string, userId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.organisation_id', ${orgId}, true), set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  });
}
