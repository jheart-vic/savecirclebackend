import { randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";
import { AppError } from "../errors.js";
import type { OrganisationType } from "../generated/prisma/enums.js";
import { withOrg, withUser } from "../tenancy.js";
import * as orgModel from "./organisations.model.js";

// Not a member, unknown, and inactive all look the same, so ids cannot be probed.
export const organisationNotFound = () => new AppError(404, "organisation_not_found", "Organisation not found");

type CreateOrganisationInput = {
  name: string;
  type: OrganisationType;
  contactPhone: string;
  contactEmail: string | null;
};

/** Creates an organisation with the caller as its Owner, in one transaction. */
export async function createOrganisation(userId: string, input: CreateOrganisationInput) {
  // The id is made here so it can be the RLS context before the row exists. This is the one
  // withOrg call with no membership check: the organisation is brand new and the caller owns it.
  const id = randomUUID();
  return withOrg(id, userId, async (tx) => {
    const organisation = await orgModel.createOrganisation({ id, ...input }, tx);
    const { role } = await orgModel.createMembership({ organisationId: id, userId, role: "owner" }, tx);
    return { organisation, role };
  });
}

/** The caller's active organisations, newest membership first. */
export async function listOrganisations(userId: string) {
  const memberships = await withUser(userId, (tx) => orgModel.listActiveMemberships(userId, tx));
  return memberships.map(({ role, organisation }) => ({ ...organisation, role }));
}

export function findActiveMembership(organisationId: string, userId: string) {
  return withUser(userId, (tx) => orgModel.findActiveMembership(organisationId, userId, tx));
}

const DAY_MS = 24 * 60 * 60 * 1000;
const storedSessionTtl = z.object({ session_ttl_days: z.number().int().positive() });

/** The organisation's session lifetime in days; the platform lifetime unless the organisation set one. */
export function sessionTtlDays(policy: unknown): number {
  const parsed = storedSessionTtl.safeParse(policy);
  return parsed.success ? parsed.data.session_ttl_days : config.SESSION_TTL_DAYS;
}

/** True when a session started at `sessionCreatedAt` is too old to act in an organisation with this policy. */
export function isSessionExpired(policy: unknown, sessionCreatedAt: Date, now = Date.now()): boolean {
  return now - sessionCreatedAt.getTime() > sessionTtlDays(policy) * DAY_MS;
}

export async function getPolicy(organisationId: string, userId: string) {
  const organisation = await withOrg(organisationId, userId, (tx) => orgModel.findPolicy(organisationId, tx));
  if (!organisation) throw organisationNotFound();
  return { sessionTtlDays: sessionTtlDays(organisation.policy) };
}

export async function setSessionTtlDays(organisationId: string, userId: string, days: number) {
  const updated = await withOrg(organisationId, userId, (tx) => orgModel.setSessionTtlDays(organisationId, days, tx));
  if (updated === 0) throw organisationNotFound();
  return { sessionTtlDays: days };
}

/** One organisation the caller is already confirmed to belong to (see requireOrgMember). */
export async function getOrganisation(organisationId: string, userId: string) {
  const organisation = await withOrg(organisationId, userId, (tx) => orgModel.findOrganisation(organisationId, tx));
  if (!organisation) throw organisationNotFound();
  return organisation;
}
