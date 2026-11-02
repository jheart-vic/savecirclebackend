import type { Db } from "../db.js";
import type { OrgRole } from "../generated/prisma/enums.js";

const inviteFields = { id: true, phoneNumber: true, role: true, expiresAt: true, createdAt: true } as const;

const pending = (now: Date) => ({ acceptedAt: null, declinedAt: null, revokedAt: null, expiresAt: { gt: now } });

/** Holds a lock on one phone within one organisation until the surrounding transaction ends. */
export function lockInviteTarget(organisationId: string, phoneNumber: string, db: Db) {
  return db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`staff-invite:${organisationId}:${phoneNumber}`}))`;
}

export function findActiveMembershipByPhone(organisationId: string, phoneNumber: string, db: Db) {
  return db.orgMembership.findFirst({
    where: { organisationId, status: "active", user: { phoneNumber } },
    select: { id: true },
  });
}

export function findPendingInvite(organisationId: string, phoneNumber: string, now: Date, db: Db) {
  return db.staffInvite.findFirst({ where: { organisationId, phoneNumber, ...pending(now) }, select: { id: true } });
}

type InviteInput = { organisationId: string; phoneNumber: string; role: OrgRole; invitedBy: string; expiresAt: Date };

export function createInvite(data: InviteInput, db: Db) {
  return db.staffInvite.create({ data, select: inviteFields });
}

export function listPendingInvites(organisationId: string, now: Date, db: Db) {
  return db.staffInvite.findMany({
    where: { organisationId, ...pending(now) },
    orderBy: { createdAt: "desc" },
    select: { ...inviteFields, inviter: { select: { name: true } } },
  });
}

export function revokeInvite(organisationId: string, id: string, now: Date, db: Db) {
  return db.staffInvite.updateMany({ where: { id, organisationId, ...pending(now) }, data: { revokedAt: now } });
}

export function findInvite(organisationId: string, id: string, db: Db) {
  return db.staffInvite.findFirst({ where: { id, organisationId }, select: { id: true } });
}

export function listMyInvites(phoneNumber: string, now: Date, db: Db) {
  return db.staffInvite.findMany({
    where: { phoneNumber, ...pending(now) },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      role: true,
      expiresAt: true,
      organisation: { select: { id: true, name: true } },
      inviter: { select: { name: true } },
    },
  });
}

export function findMyInvite(id: string, phoneNumber: string, now: Date, db: Db) {
  return db.staffInvite.findFirst({
    where: { id, phoneNumber, ...pending(now) },
    select: { organisationId: true, role: true },
  });
}

type InviteAnswer = { acceptedAt: Date } | { declinedAt: Date };

export function answerInvite(id: string, organisationId: string, phoneNumber: string, now: Date, data: InviteAnswer, db: Db) {
  return db.staffInvite.updateMany({ where: { id, organisationId, phoneNumber, ...pending(now) }, data });
}

export function findMembership(organisationId: string, userId: string, db: Db) {
  return db.orgMembership.findUnique({
    where: { organisationId_userId: { organisationId, userId } },
    select: { id: true, status: true },
  });
}

export function reactivateMembership(id: string, role: OrgRole, db: Db) {
  return db.orgMembership.update({ where: { id }, data: { status: "active", role } });
}

export function listActiveStaff(organisationId: string, db: Db) {
  return db.orgMembership.findMany({
    where: { organisationId, status: "active" },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, createdAt: true, user: { select: { name: true, phoneNumber: true } } },
  });
}

// Both staff writes skip the Owner and anyone already removed.
const changeableStaff = (organisationId: string, id: string) =>
  ({ id, organisationId, status: "active", role: { not: "owner" } }) as const;

export function changeStaffRole(organisationId: string, id: string, role: OrgRole, db: Db) {
  return db.orgMembership.updateMany({ where: changeableStaff(organisationId, id), data: { role } });
}

export function removeStaff(organisationId: string, id: string, db: Db) {
  return db.orgMembership.updateMany({ where: changeableStaff(organisationId, id), data: { status: "removed" } });
}

export function findActiveStaff(organisationId: string, id: string, db: Db) {
  return db.orgMembership.findFirst({ where: { id, organisationId, status: "active" }, select: { id: true } });
}
