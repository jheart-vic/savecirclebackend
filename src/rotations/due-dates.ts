import type { Frequency } from "../generated/prisma/enums.js";

// Calendar dates as YYYY-MM-DD, computed in UTC so no time zone can shift the day.

const toUtc = (date: string) => new Date(`${date}T00:00:00Z`);
const format = (date: Date) => date.toISOString().slice(0, 10);

/**
 * `first` moved forward by `periods` of `frequency`. Monthly keeps first's day of the
 * month and falls back to the last day of shorter months (31 Jan + 1 month = 28/29 Feb).
 */
export function addPeriods(first: string, frequency: Frequency, periods: number): string {
  const date = toUtc(first);
  if (frequency === "daily") date.setUTCDate(date.getUTCDate() + periods);
  if (frequency === "weekly") date.setUTCDate(date.getUTCDate() + 7 * periods);
  if (frequency === "monthly") {
    const anchorDay = date.getUTCDate();
    const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + periods, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(anchorDay, lastDay));
    return format(target);
  }
  return format(date);
}

/** Due dates for cycles 1..count: cycle n is due first + (n - 1) periods. */
export function dueDates(first: string, frequency: Frequency, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addPeriods(first, frequency, i));
}
