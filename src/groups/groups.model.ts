import type { Db } from "../db.js";
import type { Frequency, GroupType } from "../generated/prisma/enums.js";

const groupFields = {
  id: true,
  name: true,
  type: true,
  contributionAmount: true,
  frequency: true,
  startDate: true,
  status: true,
  reminderOffsets: true,
  createdAt: true,
} as const;

export const memberFields = { id: true, name: true, phoneNumber: true, joinOrder: true, status: true, createdAt: true } as const;

type GroupInput = {
  organisationId: string;
  name: string;
  type: GroupType;
  contributionAmount: number;
  frequency: Frequency;
  startDate: Date | null;
  reminderOffsets: number[];
  createdBy: string;
};

export function createGroup(data: GroupInput, db: Db) {
  return db.group.create({ data, select: groupFields });
}

/** Every group in the organisation, or only those `officerUserId` is assigned to. */
export function listGroups(organisationId: string, officerUserId: string | null, db: Db) {
  return db.group.findMany({
    where: { organisationId, ...(officerUserId ? { officers: { some: { userId: officerUserId } } } : {}) },
    orderBy: { createdAt: "desc" },
    select: groupFields,
  });
}

export function findGroup(organisationId: string, id: string, db: Db) {
  return db.group.findFirst({ where: { id, organisationId }, select: groupFields });
}

/** Holds the group row until the transaction ends, so join orders are handed out one at a time. */
export function lockGroup(id: string, db: Db) {
  return db.$executeRaw`SELECT 1 FROM groups WHERE id = ${id}::uuid FOR UPDATE`;
}

export function findOfficer(groupId: string, userId: string, db: Db) {
  return db.groupOfficer.findUnique({ where: { groupId_userId: { groupId, userId } }, select: { id: true } });
}

export function listOfficers(groupId: string, db: Db) {
  return db.groupOfficer.findMany({
    where: { groupId },
    orderBy: { createdAt: "asc" },
    select: { userId: true, user: { select: { name: true } } },
  });
}

export function addOfficer(data: { organisationId: string; groupId: string; userId: string }, db: Db) {
  return db.groupOfficer.create({ data, select: { userId: true, user: { select: { name: true } } } });
}

export function removeOfficer(groupId: string, userId: string, db: Db) {
  return db.groupOfficer.deleteMany({ where: { groupId, userId } });
}

export function findActiveFieldOfficer(organisationId: string, userId: string, db: Db) {
  return db.orgMembership.findFirst({
    where: { organisationId, userId, status: "active", role: "field_officer" },
    select: { id: true },
  });
}

export function listMembers(groupId: string, db: Db) {
  return db.member.findMany({ where: { groupId }, orderBy: { joinOrder: "asc" }, select: memberFields });
}

export async function nextJoinOrder(groupId: string, db: Db) {
  const { _max } = await db.member.aggregate({ where: { groupId }, _max: { joinOrder: true } });
  return (_max.joinOrder ?? 0) + 1;
}

export function findMembersByPhone(groupId: string, phoneNumbers: string[], db: Db) {
  return db.member.findMany({ where: { groupId, phoneNumber: { in: phoneNumbers } }, select: { phoneNumber: true } });
}

type MemberInput = { organisationId: string; groupId: string; name: string; phoneNumber: string; joinOrder: number };

export function createMembers(data: MemberInput[], db: Db) {
  return db.member.createManyAndReturn({ data, select: memberFields });
}
