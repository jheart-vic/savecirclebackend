import type { Db } from "../db.js";

export function findMember(groupId: string, id: string, db: Db) {
  return db.member.findFirst({ where: { id, groupId }, select: { id: true, phoneNumber: true } });
}

/** Holds a lock on one person in one organisation until the transaction ends, so payments allocate one at a time. */
export function lockPerson(organisationId: string, phoneNumber: string, db: Db) {
  return db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`allocation:${organisationId}:${phoneNumber}`}))`;
}

export type CandidateRow = {
  cycleId: string;
  memberId: string;
  groupId: string;
  groupName: string;
  groupCreatedAt: Date;
  cycleNumber: number;
  dueDate: string;
  shortfall: number;
};

/**
 * Every unpaid cycle this person owes across the organisation: the person is every member row
 * with this phone. Rotation cycles count only for a started rotation the member has a slot in.
 */
export function findCandidateCycles(organisationId: string, phoneNumber: string, db: Db) {
  return db.$queryRaw<CandidateRow[]>`
    SELECT c.id AS "cycleId", m.id AS "memberId", g.id AS "groupId", g.name AS "groupName",
           g.created_at AS "groupCreatedAt", c.cycle_number AS "cycleNumber",
           to_char(c.due_date, 'YYYY-MM-DD') AS "dueDate",
           (c.amount_due - COALESCE((
             SELECT SUM(ct.amount) FROM contributions ct WHERE ct.cycle_id = c.id AND ct.member_id = m.id
           ), 0))::int AS "shortfall"
    FROM members m
    JOIN groups g ON g.id = m.group_id
    JOIN cycles c ON c.group_id = g.id AND c.cancelled_at IS NULL
    LEFT JOIN rotations r ON r.id = c.rotation_id
    WHERE m.organisation_id = ${organisationId}::uuid
      AND m.phone_number = ${phoneNumber}
      AND (c.rotation_id IS NULL OR (
        r.status <> 'draft'
        AND EXISTS (SELECT 1 FROM rotation_slots s WHERE s.rotation_id = c.rotation_id AND s.member_id = m.id)
      ))`;
}

export type ThriftRow = { cycleId: string; memberId: string; groupId: string; groupName: string; cycleNumber: number; dueDate: string };

/**
 * The thrift cycle that takes any amount left over: in the person's oldest thrift group, the
 * latest cycle due on or before today, else its earliest cycle.
 */
export async function findThriftTarget(organisationId: string, phoneNumber: string, today: string, db: Db) {
  const rows = await db.$queryRaw<ThriftRow[]>`
    SELECT c.id AS "cycleId", m.id AS "memberId", g.id AS "groupId", g.name AS "groupName",
           c.cycle_number AS "cycleNumber", to_char(c.due_date, 'YYYY-MM-DD') AS "dueDate"
    FROM members m
    JOIN groups g ON g.id = m.group_id AND g.type = 'fixed'
    JOIN cycles c ON c.group_id = g.id AND c.cancelled_at IS NULL AND c.rotation_id IS NULL
    WHERE m.organisation_id = ${organisationId}::uuid AND m.phone_number = ${phoneNumber}
    ORDER BY g.created_at, g.id, (c.due_date <= ${today}::date) DESC,
             CASE WHEN c.due_date <= ${today}::date THEN c.due_date END DESC, c.due_date
    LIMIT 1`;
  return rows[0] ?? null;
}

type PaymentInput = {
  organisationId: string;
  memberId: string;
  amount: number;
  narration: string | null;
  receivedAt: Date;
  loggedBy: string;
};

export function createCashPayment(data: PaymentInput, db: Db) {
  return db.payment.create({
    data: { ...data, channel: "cash", matchStatus: "matched" },
    select: { id: true, amount: true, channel: true, receivedAt: true },
  });
}

type ContributionInput = {
  organisationId: string;
  cycleId: string;
  memberId: string;
  amount: number;
  paidAt: Date;
  loggedBy: string;
  paymentId: string;
};

export function createContributions(data: ContributionInput[], db: Db) {
  return db.contribution.createMany({ data });
}

export function createCredit(data: { organisationId: string; memberId: string; amount: number; sourcePaymentId: string }, db: Db) {
  return db.memberCredit.create({ data, select: { id: true } });
}
