import { prisma, type Db } from "../db.js";
import type { AuthEventType, OtpPurpose } from "../generated/prisma/enums.js";

export function findUserByPhone(phoneNumber: string, db: Db = prisma) {
  return db.user.findUnique({ where: { phoneNumber } });
}

export function createUser(data: { name: string; phoneNumber: string }, db: Db = prisma) {
  return db.user.create({ data });
}

type AuthEventInput = { userId?: string; phoneNumber: string; event: AuthEventType; ip: string };

export function recordAuthEvent(data: AuthEventInput, db: Db = prisma) {
  return db.authEvent.create({ data });
}

/** Holds a per-phone lock until the surrounding transaction ends. */
export function lockPhone(phoneNumber: string, db: Db) {
  return db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${phoneNumber}))`;
}

export function countChallengesSince(phoneNumber: string, since: Date, db: Db = prisma) {
  return db.otpChallenge.count({ where: { phoneNumber, createdAt: { gte: since } } });
}

export function countAllChallengesSince(since: Date, db: Db = prisma) {
  return db.otpChallenge.count({ where: { createdAt: { gte: since } } });
}

export function deleteChallenge(id: string, db: Db = prisma) {
  return db.otpChallenge.delete({ where: { id } });
}

type ChallengeInput = {
  phoneNumber: string;
  purpose: OtpPurpose;
  signupName: string | null;
  codeHash: string;
  expiresAt: Date;
};

export function createChallenge(data: ChallengeInput, db: Db = prisma) {
  return db.otpChallenge.create({ data });
}

export function findLatestChallenge(phoneNumber: string, db: Db = prisma) {
  return db.otpChallenge.findFirst({ where: { phoneNumber }, orderBy: { createdAt: "desc" } });
}

export function incrementAttempts(id: string, maxAttempts: number, db: Db = prisma) {
  return db.otpChallenge.updateMany({
    where: { id, attempts: { lt: maxAttempts } },
    data: { attempts: { increment: 1 } },
  });
}

/** Marks the challenge used; count is 0 if it was already used or ran out of attempts. */
export function consumeChallenge(id: string, maxAttempts: number, db: Db) {
  return db.otpChallenge.updateMany({
    where: { id, consumedAt: null, attempts: { lt: maxAttempts } },
    data: { consumedAt: new Date() },
  });
}

type SessionInput = { userId: string; tokenHash: string; expiresAt: Date };

export function createSession(data: SessionInput, db: Db = prisma) {
  return db.session.create({ data });
}

export function findActiveSession(tokenHash: string, db: Db = prisma) {
  return db.session.findFirst({
    where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
    include: { user: true },
  });
}

export function listActiveSessions(userId: string, db: Db = prisma) {
  return db.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, expiresAt: true },
  });
}

/** Revokes one of the user's sessions; count is 0 if it was not theirs or already revoked. */
export function revokeSession(id: string, userId: string, db: Db = prisma) {
  return db.session.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
