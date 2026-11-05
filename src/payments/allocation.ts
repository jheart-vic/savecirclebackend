// The allocation engine: how one payment splits across a person's cycles. Pure, so it can be
// checked without a database. All amounts are integer kobo.

export type CandidateCycle = {
  cycleId: string;
  memberId: string;
  groupId: string;
  groupCreatedAt: Date;
  cycleNumber: number;
  dueDate: string; // YYYY-MM-DD
  shortfall: number; // amount due minus what is already paid, > 0
};

// The cycle that takes any amount left once every shortfall is paid (a thrift deposit).
export type ThriftTarget = { cycleId: string; memberId: string } | null;

export type Allocation = {
  lines: { cycleId: string; memberId: string; amount: number }[];
  credit: number;
};

/** Oldest due date first; ties go to the oldest group, then by group and cycle number. */
function compareCycles(a: CandidateCycle, b: CandidateCycle): number {
  return (
    a.dueDate.localeCompare(b.dueDate) ||
    a.groupCreatedAt.getTime() - b.groupCreatedAt.getTime() ||
    a.groupId.localeCompare(b.groupId) ||
    a.cycleNumber - b.cycleNumber
  );
}

export function allocate(amount: number, cycles: CandidateCycle[], thrift: ThriftTarget): Allocation {
  let left = amount;
  const byCycle = new Map<string, { cycleId: string; memberId: string; amount: number }>();
  const add = (cycleId: string, memberId: string, part: number) => {
    const line = byCycle.get(cycleId) ?? { cycleId, memberId, amount: 0 };
    line.amount += part;
    byCycle.set(cycleId, line);
  };

  for (const cycle of [...cycles].sort(compareCycles)) {
    if (left === 0) break;
    if (cycle.shortfall <= 0) continue;
    const part = Math.min(left, cycle.shortfall);
    add(cycle.cycleId, cycle.memberId, part);
    left -= part;
  }

  if (left > 0 && thrift) {
    add(thrift.cycleId, thrift.memberId, left);
    left = 0;
  }

  return { lines: [...byCycle.values()], credit: left };
}
