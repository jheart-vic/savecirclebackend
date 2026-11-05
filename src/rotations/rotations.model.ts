import type { Db } from "../db.js";

export function createRotation(data: { organisationId: string; groupId: string; rotationNumber: number }, db: Db) {
  return db.rotation.create({ data, select: { id: true } });
}

/** The group's latest rotation, with its slots and cycles in order. */
export function findCurrentRotation(groupId: string, db: Db) {
  return db.rotation.findFirst({
    where: { groupId },
    orderBy: { rotationNumber: "desc" },
    select: {
      id: true,
      rotationNumber: true,
      status: true,
      firstDueDate: true,
      startedAt: true,
      slots: {
        orderBy: { position: "asc" },
        select: { id: true, position: true, memberId: true, status: true, member: { select: { name: true } } },
      },
      cycles: {
        orderBy: { cycleNumber: "asc" },
        select: { cycleNumber: true, dueDate: true, amountDue: true, payoutSlot: { select: { position: true } } },
      },
    },
  });
}

export function findDraftRotation(groupId: string, db: Db) {
  return db.rotation.findFirst({ where: { groupId, status: "draft" }, select: { id: true } });
}

export async function nextPosition(rotationId: string, db: Db) {
  const { _max } = await db.rotationSlot.aggregate({ where: { rotationId }, _max: { position: true } });
  return (_max.position ?? 0) + 1;
}

type SlotInput = { organisationId: string; rotationId: string; memberId: string; position: number };

export function createSlots(data: SlotInput[], db: Db) {
  return db.rotationSlot.createMany({ data });
}

// Positions are unique per rotation, so a reorder first moves every slot out of the way.
export function moveSlotsAside(rotationId: string, db: Db) {
  return db.$executeRaw`UPDATE rotation_slots SET position = -position WHERE rotation_id = ${rotationId}::uuid`;
}

export function setSlotPosition(id: string, position: number, db: Db) {
  return db.rotationSlot.update({ where: { id }, data: { position }, select: { id: true } });
}

export function activateRotation(id: string, firstDueDate: Date, db: Db) {
  return db.rotation.updateMany({
    where: { id, status: "draft" },
    data: { status: "active", firstDueDate, startedAt: new Date() },
  });
}

type CycleInput = {
  organisationId: string;
  groupId: string;
  rotationId: string;
  cycleNumber: number;
  dueDate: Date;
  amountDue: number;
  payoutSlotId: string;
};

export function createCycles(data: CycleInput[], db: Db) {
  return db.cycle.createMany({ data });
}
