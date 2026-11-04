import type { Db } from "../db.js";
import type { OrganisationType, OrgRole } from "../generated/prisma/enums.js";

// The organisation fields the API may return; new columns stay private until added here.
export const organisationFields = {
  id: true,
  name: true,
  type: true,
  contactEmail: true,
  contactPhone: true,
  moneyMode: true,
  createdAt: true,
} as const;

type OrganisationInput = {
  id: string;
  name: string;
  type: OrganisationType;
  contactPhone: string;
  contactEmail: string | null;
};

export function createOrganisation(data: OrganisationInput, db: Db) {
  return db.organisation.create({ data, select: organisationFields });
}

type MembershipInput = { organisationId: string; userId: string; role: OrgRole };

export function createMembership(data: MembershipInput, db: Db) {
  return db.orgMembership.create({ data, select: { role: true } });
}

export function listActiveMemberships(userId: string, db: Db) {
  return db.orgMembership.findMany({
    where: { userId, status: "active" },
    orderBy: { createdAt: "desc" },
    select: { role: true, organisation: { select: { id: true, name: true, type: true } } },
  });
}

export function findActiveMembership(organisationId: string, userId: string, db: Db) {
  return db.orgMembership.findFirst({
    where: { organisationId, userId, status: "active" },
    select: { id: true, role: true, organisation: { select: { policy: true } } },
  });
}

export function findOrganisation(id: string, db: Db) {
  return db.organisation.findUnique({ where: { id }, select: organisationFields });
}

export function findPolicy(id: string, db: Db) {
  return db.organisation.findUnique({ where: { id }, select: { policy: true } });
}

// Merges one key into the policy object, so other keys written at the same time survive.
export function setSessionTtlDays(id: string, days: number, db: Db) {
  return db.$executeRaw`UPDATE organisations SET policy = policy || jsonb_build_object('session_ttl_days', ${days}::int) WHERE id = ${id}::uuid`;
}
