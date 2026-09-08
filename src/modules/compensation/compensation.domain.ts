/**
 * Compensation — pure functions, no database.
 *
 * The only rule here is which revision applies, and it is worth stating
 * precisely because getting it wrong shows somebody a raise before they have
 * been told about it.
 */

import { CompensationRecord } from './compensation.model';

/**
 * The revision in force on `onDate`: the most recent one that has already
 * taken effect.
 *
 * A row dated in the future is a revision that has been agreed but not yet
 * started. It must not be shown — an April raise entered in February is
 * confidential until April, and payroll would pay the wrong figure for two
 * months if it leaked early. "Latest row" is the wrong rule; "latest row that
 * has started" is the right one.
 *
 * Returns null when the employee has no compensation on record at all, which is
 * a real answer rather than an error: most records are not loaded yet.
 */
export function compensationOn(
  history: CompensationRecord[],
  onDate: string,
): CompensationRecord | null {
  let current: CompensationRecord | null = null;

  for (const revision of history) {
    if (revision.effectiveFrom > onDate) continue;
    if (!current || revision.effectiveFrom > current.effectiveFrom) current = revision;
  }

  return current;
}

/**
 * Units the employee actually holds today, as opposed to the units granted.
 * Rounded to whole units — a fraction of a share is not a thing anybody owns.
 */
export const vestedUnits = (record: CompensationRecord): number =>
  Math.round((record.esopUnits * record.esopVestedPct) / 100);
