import { randomUUID } from "node:crypto";
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

/** One organisation the caller is already confirmed to belong to (see requireOrgMember). */
export async function getOrganisation(organisationId: string, userId: string) {
  const organisation = await withOrg(organisationId, userId, (tx) => orgModel.findOrganisation(organisationId, tx));
  if (!organisation) throw organisationNotFound();
  return organisation;
}
