import { normalizePhone } from "../auth/phone.js";
import type { Db } from "../db.js";
import { AppError } from "../errors.js";
import type { Frequency, GroupType, OrgRole } from "../generated/prisma/enums.js";
import { Prisma } from "../generated/prisma/client.js";
import { withOrg } from "../tenancy.js";
import { parseCsv } from "./csv.js";
import * as groupModel from "./groups.model.js";
import { DEFAULT_REMINDER_OFFSETS, MAX_IMPORT_ROWS, memberName } from "./groups.validation.js";

// Field officers see only their assigned groups; branches (feature 32) will narrow branch managers.
const SEES_ALL_GROUPS: OrgRole[] = ["owner", "admin", "treasurer", "branch_manager"];
const MANAGES_MEMBERS: OrgRole[] = ["owner", "admin", "field_officer"];

export type Actor = { organisationId: string; userId: string; role: OrgRole };

const groupNotFound = () => new AppError(404, "group_not_found", "Group not found");
const forbidden = () => new AppError(403, "forbidden", "Your role cannot do this");

type GroupRow = Awaited<ReturnType<typeof groupModel.createGroup>>;

// A date column comes back as midnight UTC; the API speaks YYYY-MM-DD.
const toGroup = ({ startDate, ...group }: GroupRow) => ({
  ...group,
  startDate: startDate ? startDate.toISOString().slice(0, 10) : null,
});

/** The group if the actor may see it; unknown and hidden groups look the same. */
async function visibleGroup(actor: Actor, groupId: string, tx: Db) {
  const group = await groupModel.findGroup(actor.organisationId, groupId, tx);
  if (!group) throw groupNotFound();
  if (!SEES_ALL_GROUPS.includes(actor.role) && !(await groupModel.findOfficer(groupId, actor.userId, tx))) {
    throw groupNotFound();
  }
  return group;
}

type CreateGroupInput = {
  name: string;
  type: GroupType;
  contributionAmount: number;
  frequency: Frequency;
  startDate?: string;
  reminderOffsets?: number[];
};

export async function createGroup(actor: Actor, input: CreateGroupInput) {
  const { organisationId, userId } = actor;
  const group = await withOrg(organisationId, userId, async (tx) => {
    const group = await groupModel.createGroup(
      {
        organisationId,
        name: input.name,
        type: input.type,
        contributionAmount: input.contributionAmount,
        frequency: input.frequency,
        startDate: input.startDate ? new Date(`${input.startDate}T00:00:00Z`) : null,
        reminderOffsets: input.reminderOffsets ?? DEFAULT_REMINDER_OFFSETS,
        createdBy: userId,
      },
      tx,
    );
    if (actor.role === "field_officer") await groupModel.addOfficer({ organisationId, groupId: group.id, userId }, tx);
    return group;
  });
  return toGroup(group);
}

export async function listGroups(actor: Actor) {
  const officerOnly = SEES_ALL_GROUPS.includes(actor.role) ? null : actor.userId;
  const groups = await withOrg(actor.organisationId, actor.userId, (tx) =>
    groupModel.listGroups(actor.organisationId, officerOnly, tx),
  );
  return groups.map(toGroup);
}

export async function getGroup(actor: Actor, groupId: string) {
  return withOrg(actor.organisationId, actor.userId, async (tx) => {
    const group = await visibleGroup(actor, groupId, tx);
    const members = await groupModel.listMembers(groupId, tx);
    const officers = await groupModel.listOfficers(groupId, tx);
    return {
      group: toGroup(group),
      members,
      officers: officers.map(({ userId, user }) => ({ userId, name: user.name })),
    };
  });
}

export async function assignOfficer(actor: Actor, groupId: string, officerUserId: string) {
  return withOrg(actor.organisationId, actor.userId, async (tx) => {
    await visibleGroup(actor, groupId, tx);
    if (!(await groupModel.findActiveFieldOfficer(actor.organisationId, officerUserId, tx))) {
      throw new AppError(400, "not_a_field_officer", "Only an active field officer in this organisation can be assigned");
    }
    try {
      const { userId, user } = await groupModel.addOfficer(
        { organisationId: actor.organisationId, groupId, userId: officerUserId },
        tx,
      );
      return { userId, name: user.name };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError(409, "officer_already_assigned", "This officer is already assigned to the group");
      }
      throw error;
    }
  });
}

export async function unassignOfficer(actor: Actor, groupId: string, officerUserId: string): Promise<void> {
  await withOrg(actor.organisationId, actor.userId, async (tx) => {
    await visibleGroup(actor, groupId, tx);
    const { count } = await groupModel.removeOfficer(groupId, officerUserId, tx);
    if (count === 0) throw new AppError(404, "officer_not_assigned", "This officer is not assigned to the group");
  });
}

type NewMember = { name: string; phoneNumber: string };

// Locks the group, rejects phones already in it, and numbers the new members after the existing ones.
async function insertMembers(actor: Actor, groupId: string, newMembers: NewMember[], tx: Db) {
  await visibleGroup(actor, groupId, tx);
  if (!MANAGES_MEMBERS.includes(actor.role)) throw forbidden();
  await groupModel.lockGroup(groupId, tx);
  const existing = await groupModel.findMembersByPhone(groupId, newMembers.map((m) => m.phoneNumber), tx);
  const first = await groupModel.nextJoinOrder(groupId, tx);
  const rows = newMembers.map((member, i) => ({
    organisationId: actor.organisationId,
    groupId,
    ...member,
    joinOrder: first + i,
  }));
  return { existing: new Set(existing.map((m) => m.phoneNumber)), insert: () => groupModel.createMembers(rows, tx) };
}

export async function addMember(actor: Actor, groupId: string, member: NewMember) {
  return withOrg(actor.organisationId, actor.userId, async (tx) => {
    const { existing, insert } = await insertMembers(actor, groupId, [member], tx);
    if (existing.size > 0) throw new AppError(409, "member_exists", "This phone number is already in the group");
    const [created] = await insert();
    return created;
  });
}

type RowError = { line: number; message: string };

const invalidCsv = (message: string, rows: RowError[] = []) =>
  new AppError(400, "invalid_csv", message, rows.length > 0 ? { rows } : undefined);

/** Reads `name,phone` rows; every row must be valid or nothing is imported. */
function readMemberCsv(text: string): { line: number; member: NewMember }[] {
  let rows;
  try {
    rows = parseCsv(text).filter((row) => row.fields.some((field) => field.trim() !== ""));
  } catch (error) {
    throw invalidCsv((error as Error).message);
  }
  const [header, ...data] = rows;
  const columns = header?.fields.map((field) => field.trim().toLowerCase()) ?? [];
  if (columns.length !== 2 || !columns.includes("name") || !columns.includes("phone")) {
    throw invalidCsv("The first row must be the header: name,phone");
  }
  if (data.length === 0) throw invalidCsv("The file has no member rows");
  if (data.length > MAX_IMPORT_ROWS) throw invalidCsv(`At most ${MAX_IMPORT_ROWS} members per file`);

  const nameAt = columns.indexOf("name");
  const phoneAt = columns.indexOf("phone");
  const errors: RowError[] = [];
  const seen = new Map<string, number>();
  const members = data.map(({ line, fields }) => {
    if (fields.length !== 2) errors.push({ line, message: "Expected 2 columns: name and phone" });
    const name = memberName.safeParse(fields[nameAt] ?? "");
    if (!name.success) errors.push({ line, message: "Name is missing or longer than 100 characters" });
    const phoneNumber = normalizePhone(fields[phoneAt] ?? "");
    if (!phoneNumber) errors.push({ line, message: "Enter a valid Nigerian mobile number" });
    else if (seen.has(phoneNumber)) errors.push({ line, message: `Same phone as line ${seen.get(phoneNumber)}` });
    else seen.set(phoneNumber, line);
    return { line, member: { name: name.success ? name.data : "", phoneNumber: phoneNumber ?? "" } };
  });
  if (errors.length > 0) throw invalidCsv("Some rows are invalid; no members were added", errors);
  return members;
}

export async function importMembers(actor: Actor, groupId: string, text: string) {
  const rows = readMemberCsv(text);
  return withOrg(actor.organisationId, actor.userId, async (tx) => {
    const { existing, insert } = await insertMembers(actor, groupId, rows.map((row) => row.member), tx);
    const clashes = rows
      .filter((row) => existing.has(row.member.phoneNumber))
      .map(({ line }) => ({ line, message: "This phone number is already in the group" }));
    if (clashes.length > 0) throw invalidCsv("Some rows are invalid; no members were added", clashes);
    const created = await insert();
    return created.sort((a, b) => a.joinOrder - b.joinOrder);
  });
}
