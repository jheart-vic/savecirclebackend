import type { Db } from "../db.js";
import { AppError } from "../errors.js";
import type { OrgRole } from "../generated/prisma/enums.js";
import * as orgModel from "../organisations/organisations.model.js";
import { withOrg, withUser } from "../tenancy.js";
import { sendSms, termiiConfigured } from "../termii.js";
import * as staffModel from "./staff.model.js";

const INVITE_TTL_DAYS = 7;

const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Owner",
  admin: "Admin",
  treasurer: "Treasurer",
  branch_manager: "Branch manager",
  field_officer: "Field officer",
};

const alreadyMember = () => new AppError(409, "already_member", "This person is already a member of the organisation");
const inviteNotFound = () => new AppError(404, "invite_not_found", "Invite not found");

type Inviter = { id: string; name: string };

/** Invites a phone to the organisation with a role, then texts them a notice. */
export async function createInvite(organisationId: string, inviter: Inviter, phoneNumber: string, role: OrgRole) {
  const now = new Date();
  const { invite, organisationName } = await withOrg(organisationId, inviter.id, async (tx) => {
    await staffModel.lockInviteTarget(organisationId, phoneNumber, tx);
    if (await staffModel.findActiveMembershipByPhone(organisationId, phoneNumber, tx)) throw alreadyMember();
    if (await staffModel.findPendingInvite(organisationId, phoneNumber, now, tx)) {
      throw new AppError(409, "invite_pending", "This number already has a pending invite");
    }
    const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const invite = await staffModel.createInvite(
      { organisationId, phoneNumber, role, invitedBy: inviter.id, expiresAt },
      tx,
    );
    const organisation = await orgModel.findOrganisation(organisationId, tx);
    return { invite, organisationName: organisation!.name };
  });

  const text =
    `${inviter.name} invited you to join ${organisationName} on SaveCircle as ${ROLE_LABELS[role]}. ` +
    `Sign in to SaveCircle with this number to accept. The invite expires in ${INVITE_TTL_DAYS} days.`;
  return { invite, notified: await sendNotice(phoneNumber, text) };
}

// The invite is already saved and shows up when the invitee signs in, so a failed text only reports false.
async function sendNotice(phoneNumber: string, text: string): Promise<boolean> {
  if (!termiiConfigured) return false;
  try {
    await sendSms(phoneNumber, text);
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}

/** The organisation's pending invites, newest first. */
export async function listInvites(organisationId: string, userId: string) {
  const invites = await withOrg(organisationId, userId, (tx) =>
    staffModel.listPendingInvites(organisationId, new Date(), tx),
  );
  return invites.map(({ inviter, ...invite }) => ({ ...invite, invitedBy: { name: inviter.name } }));
}

export async function revokeInvite(organisationId: string, userId: string, inviteId: string): Promise<void> {
  await withOrg(organisationId, userId, async (tx) => {
    const { count } = await staffModel.revokeInvite(organisationId, inviteId, new Date(), tx);
    if (count === 1) return;
    if (!(await staffModel.findInvite(organisationId, inviteId, tx))) throw inviteNotFound();
    throw new AppError(409, "invite_not_pending", "This invite was already accepted, declined, revoked, or has expired");
  });
}

type Invitee = { id: string; phoneNumber: string };

/** Pending invites sent to the caller's phone, newest first. */
export async function listMyInvites(user: Invitee) {
  const invites = await withUser(user.id, (tx) => staffModel.listMyInvites(user.phoneNumber, new Date(), tx));
  return invites.map(({ inviter, ...invite }) => ({ ...invite, invitedBy: { name: inviter.name } }));
}

async function findMyInvite(user: Invitee, inviteId: string, now: Date) {
  const invite = await withUser(user.id, (tx) => staffModel.findMyInvite(inviteId, user.phoneNumber, now, tx));
  if (!invite) throw inviteNotFound();
  return invite;
}

// Accept and decline open withOrg without a membership check: a pending invite sent to the
// caller's own phone is what lets them in. The update below re-checks it inside the transaction.
export async function acceptInvite(user: Invitee, inviteId: string) {
  const now = new Date();
  const { organisationId, role } = await findMyInvite(user, inviteId, now);
  return withOrg(organisationId, user.id, async (tx) => {
    const { count } = await staffModel.answerInvite(inviteId, organisationId, user.phoneNumber, now, { acceptedAt: now }, tx);
    if (count === 0) throw inviteNotFound();
    const membership = await staffModel.findMembership(organisationId, user.id, tx);
    if (membership?.status === "active") throw alreadyMember();
    if (membership) await staffModel.reactivateMembership(membership.id, role, tx);
    else await orgModel.createMembership({ organisationId, userId: user.id, role }, tx);
    const organisation = await orgModel.findOrganisation(organisationId, tx);
    return { organisation: { id: organisationId, name: organisation!.name }, role };
  });
}

export async function declineInvite(user: Invitee, inviteId: string): Promise<void> {
  const now = new Date();
  const { organisationId } = await findMyInvite(user, inviteId, now);
  await withOrg(organisationId, user.id, async (tx) => {
    const { count } = await staffModel.answerInvite(inviteId, organisationId, user.phoneNumber, now, { declinedAt: now }, tx);
    if (count === 0) throw inviteNotFound();
  });
}

/** Active staff, Owner first, then oldest membership first. */
export async function listStaff(organisationId: string, userId: string) {
  const staff = await withOrg(organisationId, userId, (tx) => staffModel.listActiveStaff(organisationId, tx));
  return staff
    .map(({ id, role, createdAt, user }) => ({ membershipId: id, ...user, role, joinedAt: createdAt }))
    .sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner"));
}

async function writeStaff(
  organisationId: string,
  userId: string,
  membershipId: string,
  write: (tx: Db) => Promise<{ count: number }>,
) {
  await withOrg(organisationId, userId, async (tx) => {
    const { count } = await write(tx);
    if (count === 1) return;
    // Nothing changed: either the membership is the Owner, or it is not an active member here.
    if (await staffModel.findActiveStaff(organisationId, membershipId, tx)) {
      throw new AppError(409, "owner_protected", "The Owner's membership cannot be changed or removed");
    }
    throw new AppError(404, "staff_not_found", "Staff member not found");
  });
}

export function changeRole(organisationId: string, userId: string, membershipId: string, role: OrgRole) {
  return writeStaff(organisationId, userId, membershipId, (tx) => staffModel.changeStaffRole(organisationId, membershipId, role, tx));
}

export function removeStaff(organisationId: string, userId: string, membershipId: string) {
  return writeStaff(organisationId, userId, membershipId, (tx) => staffModel.removeStaff(organisationId, membershipId, tx));
}
