/**
 * Date arithmetic on plain `YYYY-MM-DD` strings.
 *
 * Shared rather than per-module because it carries no domain meaning — it is
 * infrastructure, like the audit writer. Two modules doing their own date maths
 * is how timezone handling drifts apart, and every function here works in UTC
 * precisely so a local timezone can never shift a date by a day.
 */

/** `date` shifted by `days`. Negative goes backwards. */
export function addDays(date: string, days: number): string {
  const cursor = new Date(`${date}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
}

/**
 * `date` shifted by whole months, clamped to the end of the target month —
 * 31 January plus one month is 28 February, not 3 March.
 */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`. Negative when `to` precedes `from`. */
export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Every date from `from` to `to` inclusive, oldest first. */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  if (to < from) return out;
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`).getTime();
  // Bounded: a malformed range can never spin, whatever a caller passes.
  for (let i = 0; cursor.getTime() <= end && i < 400; i++) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}
