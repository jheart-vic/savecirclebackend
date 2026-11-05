import type { Db } from "../db.js";
import { AppError } from "../errors.js";
import * as groupModel from "../groups/groups.model.js";
import { type Actor, assertManagesMembers, visibleGroup } from "../groups/groups.service.js";
import { todayInLagos } from "../groups/groups.validation.js";
import { withOrg } from "../tenancy.js";
import { addPeriods, dueDates } from "./due-dates.js";
import * as rotationModel from "./rotations.model.js";

const MIN_SLOTS_TO_START = 2;

const rotationNotFound = () => new AppError(404, "rotation_not_found", "Rotation not found");
const notDraft = () => new AppError(409, "rotation_not_draft", "This rotation has already started");

type RotationRow = NonNullable<Awaited<ReturnType<typeof rotationModel.findCurrentRotation>>>;

const toDate = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

const toRotation = (rotation: RotationRow) => ({
  id: rotation.id,
  rotationNumber: rotation.rotationNumber,
  status: rotation.status,
  firstDueDate: toDate(rotation.firstDueDate),
  startedAt: rotation.startedAt,
  slots: rotation.slots.map(({ position, memberId, status, member }) => ({ position, memberId, name: member.name, status })),
  cycles: rotation.cycles.map(({ cycleNumber, dueDate, amountDue, payoutSlot }) => ({
    cycleNumber,
    dueDate: toDate(dueDate),
    amountDue,
    payoutPosition: payoutSlot?.position ?? null,
  })),
});

/** The group (when the actor may see it and it is rotating) and its current rotation. */
async function currentRotation(actor: Actor, groupId: string, tx: Db) {
  const group = await visibleGroup(actor, groupId, tx);
  if (group.type !== "rotating") throw rotationNotFound();
  const rotation = await rotationModel.findCurrentRotation(groupId, tx);
  if (!rotation) throw rotationNotFound();
  return { group, rotation };
}

// Reorder and start take the same group-row lock as adding members, so a member cannot
// join the draft while it is being reordered or started.
async function lockedDraft(actor: Actor, groupId: string, tx: Db) {
  await visibleGroup(actor, groupId, tx);
  assertManagesMembers(actor);
  await groupModel.lockGroup(groupId, tx);
  const current = await currentRotation(actor, groupId, tx);
  if (current.rotation.status !== "draft") throw notDraft();
  return current;
}

export async function getRotation(actor: Actor, groupId: string) {
  return withOrg(actor.organisationId, actor.userId, async (tx) => toRotation((await currentRotation(actor, groupId, tx)).rotation));
}

export async function reorder(actor: Actor, groupId: string, memberIds: string[]) {
  return withOrg(actor.organisationId, actor.userId, async (tx) => {
    const { rotation } = await lockedDraft(actor, groupId, tx);
    const slotByMember = new Map(rotation.slots.map((slot) => [slot.memberId, slot.id]));
    const valid =
      memberIds.length === slotByMember.size &&
      new Set(memberIds).size === memberIds.length &&
      memberIds.every((id) => slotByMember.has(id));
    if (!valid) {
      throw new AppError(400, "invalid_order", "List every member of the draft rotation exactly once");
    }
    await rotationModel.moveSlotsAside(rotation.id, tx);
    for (const [i, memberId] of memberIds.entries()) {
      await rotationModel.setSlotPosition(slotByMember.get(memberId)!, i + 1, tx);
    }
    return toRotation((await rotationModel.findCurrentRotation(groupId, tx))!);
  });
}

export async function start(actor: Actor, groupId: string, firstDueDate?: string) {
  return withOrg(actor.organisationId, actor.userId, async (tx) => {
    const { group, rotation } = await lockedDraft(actor, groupId, tx);
    if (rotation.slots.length < MIN_SLOTS_TO_START) {
      throw new AppError(409, "rotation_too_small", `A rotation needs at least ${MIN_SLOTS_TO_START} members to start`);
    }
    const first = firstDueDate ?? addPeriods(todayInLagos(), group.frequency, 1);
    const { count } = await rotationModel.activateRotation(rotation.id, new Date(`${first}T00:00:00Z`), tx);
    if (count === 0) throw notDraft();
    const dates = dueDates(first, group.frequency, rotation.slots.length);
    await rotationModel.createCycles(
      rotation.slots.map((slot, i) => ({
        organisationId: actor.organisationId,
        groupId,
        rotationId: rotation.id,
        cycleNumber: slot.position,
        dueDate: new Date(`${dates[i]}T00:00:00Z`),
        amountDue: group.contributionAmount,
        payoutSlotId: slot.id,
      })),
      tx,
    );
    return toRotation((await rotationModel.findCurrentRotation(groupId, tx))!);
  });
}
