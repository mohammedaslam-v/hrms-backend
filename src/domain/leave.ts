/**
 * Leave accrual and balance — pure functions, no database.
 *
 * Policy (Bambinos):
 *   · 2 Earned Leaves credited on the 1st of every month
 *   · 24 a year, accruing from the employee's joining month
 *   · The LEAVE year runs January–December. This is a different cycle from the
 *     financial year (April–March), which drives payroll and tax.
 *   · There are no declared festival holidays — the 24 covers everything, so a
 *     festival day off is deducted like any other leave.
 *   · Leave beyond the accumulated balance is loss of pay for that month, and
 *     the shortfall is SETTLED THERE — by the salary deduction. It is not
 *     carried forward as a debt, so each month starts from zero or better and
 *     the next month's credit is the employee's to spend in full.
 *
 * Nothing here is stored. Balance is recomputed from the accrual rule and the
 * approved requests every time it is shown, so it can never drift from the
 * transactions that produced it.
 */

export type LeaveType = 'Casual' | 'Sick' | 'Earned' | 'Unpaid';

/** Which half of the day a half-day request covers. */
export type HalfDaySession = 'first' | 'second';
export type LeaveStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';

export interface LeaveRequestRecord {
  id: number;
  ref: string;
  leaveType: LeaveType;
  fromDate: string;
  toDate: string;
  /** Total working days in the request. */
  days: number;
  /**
   * How many of `days` are loss of pay. The remainder draws from the balance.
   * A request the balance could only partly cover is split rather than being
   * made wholly unpaid — the earned days the employee has are still used.
   */
  unpaidDays: number;
  status: LeaveStatus;
}

export const HALF_DAY_SESSION_LABEL: Record<HalfDaySession, string> = {
  first: 'Session 1 · first half',
  second: 'Session 2 · second half',
};

export interface LedgerInput {
  openingLeave: number;
  /** Needed to attribute a request's days to the months they fall in. */
  weeklyOff: string[];
  holidays: ReadonlySet<string>;
  /** Unused leave carries into the new year only up to this many days. */
  carryCap: number;
  dateOfJoining: string;
  dateOfLeaving: string | null;
  yearStart: string;
  leavePerMonth: number;
  /** Month to compute up to, inclusive. Defaults to the current month. */
  uptoMonth: string;
  requests: LeaveRequestRecord[];
  adjustments: number;
}

export interface LedgerRow {
  month: string;
  /** Monthly accrual posted on the 1st. Zero before joining / after leaving. */
  credit: number;
  /** Paid-type leave days falling in this month. They draw on the balance. */
  taken: number;
  /** Days from requests the employee explicitly chose as Unpaid. */
  unpaid: number;
  /** Loss of pay incurred in this month — the amount the balance went short by. */
  lop: number;
  /** Running balance at month end. Never negative: a shortfall is paid off as LOP. */
  closing: number;
}

export interface LeaveLedger {
  opening: number;
  credited: number;
  taken: number;
  lop: number;
  pending: number;
  adjustments: number;
  balance: number;
  /** What can actually be applied for — pending requests are not yet deducted. */
  available: number;
  rows: LedgerRow[];
  lastLeaveOn: string | null;
}

// ---------------------------------------------------------------- date helpers
// Dates are plain YYYY-MM-DD strings throughout, so nothing here can be shifted
// by a timezone.

export const monthKeyOf = (date: string): string => date.slice(0, 7);

export const parseDate = (date: string): Date => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

export const toIso = (date: Date): string => date.toISOString().slice(0, 10);

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const dayNameOf = (date: string): string => DAY_NAMES[parseDate(date).getUTCDay()];

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const end = parseDate(to).getTime();
  const cursor = parseDate(from);
  // Guard against a reversed or absurd range producing an unbounded loop.
  for (let i = 0; cursor.getTime() <= end && i < 1000; i++) {
    out.push(toIso(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export function addMonths(monthKey: string, count: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const total = y * 12 + (m - 1) + count;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Every month of the leave year up to and including `upto`. */
export function leaveYearMonths(yearStart: string, upto: string): string[] {
  const out: string[] = [];
  let month = monthKeyOf(yearStart);
  for (let i = 0; i < 12; i++) {
    out.push(month);
    if (month === upto) break;
    month = addMonths(month, 1);
  }
  return out;
}

// ---------------------------------------------------------------- day counting

/**
 * Days actually deducted by a request. Weekly offs and declared holidays are
 * skipped, which is why Friday-to-Monday is 3 days and not 4 for someone who is
 * off on Sunday. Employees check this, so it is per-employee: weekly offs differ.
 */
export function workingDaysBetween(
  from: string,
  to: string,
  weeklyOff: string[],
  holidays: ReadonlySet<string>,
): number {
  if (to < from) return 0;
  const off = new Set(weeklyOff);
  return eachDay(from, to).filter((d) => !off.has(dayNameOf(d)) && !holidays.has(d)).length;
}

// ---------------------------------------------------------------- the ledger

/**
 * Spread a request's days across the months it spans.
 *
 * The stored `days` is authoritative (it already accounts for half-days), so the
 * per-month working days are used only as weights and then scaled to match it.
 */
export function daysByMonth(
  request: LeaveRequestRecord,
  weeklyOff: string[],
  holidays: ReadonlySet<string>,
): Map<string, number> {
  const out = new Map<string, number>();
  const off = new Set(weeklyOff);

  for (const day of eachDay(request.fromDate, request.toDate)) {
    if (off.has(dayNameOf(day)) || holidays.has(day)) continue;
    const month = monthKeyOf(day);
    out.set(month, (out.get(month) ?? 0) + 1);
  }

  const counted = [...out.values()].reduce((sum, n) => sum + n, 0);
  if (counted === 0) return out;

  // Scale so a half-day request contributes 0.5, not 1.
  const scale = request.days / counted;
  for (const [month, n] of out) out.set(month, round1(n * scale));
  return out;
}

/**
 * Walks the leave year month by month, applying each month's credit and the
 * leave taken in it.
 *
 * Why a simulation rather than one subtraction: whether a day is paid depends on
 * the balance in the month it falls in, so a request spanning a month boundary
 * can be part paid and part loss of pay.
 *
 * Each month is settled on its own. A shortfall is that month's loss of pay and
 * is recovered through the salary deduction, so it does not follow the employee
 * into the next month: the balance floors at zero and next month's credit is
 * theirs in full.
 */
export function computeLedger(input: LedgerInput): LeaveLedger {
  const joinMonth = monthKeyOf(input.dateOfJoining);
  const leaveMonth = input.dateOfLeaving ? monthKeyOf(input.dateOfLeaving) : null;

  const approved = input.requests.filter((r) => r.status === 'Approved');

  // Paid-type days draw on the balance; explicitly Unpaid days never do.
  const paidByMonth = new Map<string, number>();
  const unpaidByMonth = new Map<string, number>();

  for (const request of approved) {
    const target = request.leaveType === 'Unpaid' ? unpaidByMonth : paidByMonth;
    for (const [month, days] of daysByMonth(request, input.weeklyOff, input.holidays)) {
      target.set(month, round1((target.get(month) ?? 0) + days));
    }
  }

  // Carry-forward is capped by policy, and adjustments (encashment, lapse,
  // corrections) are applied at the start of the year.
  const opening = Math.min(input.openingLeave, input.carryCap);
  let running = round1(opening + input.adjustments);

  const rows: LedgerRow[] = [];
  let credited = 0;
  let takenTotal = 0;
  let lopTotal = 0;

  for (const month of leaveYearMonths(input.yearStart, input.uptoMonth)) {
    const onPayroll = month >= joinMonth && (!leaveMonth || month <= leaveMonth);
    const credit = onPayroll ? input.leavePerMonth : 0;
    const taken = paidByMonth.get(month) ?? 0;
    const unpaid = unpaidByMonth.get(month) ?? 0;

    // What the month has to spend, before this month's leave is taken out.
    const spendable = round1(running + credit);

    // Days taken beyond what the month could cover are this month's loss of pay,
    // recovered from salary. Days the employee chose as unpaid are LOP outright.
    const covered = Math.min(taken, Math.max(0, spendable));
    const shortfall = round1(taken - covered);
    const lop = round1(shortfall + unpaid);

    // Only the covered days come off the balance. The shortfall is settled by
    // the salary deduction, so it is not carried into the next month as a debt —
    // a balance below zero here can only come from an adjustment, never a LOP.
    running = round1(spendable - covered);

    credited = round1(credited + credit);
    takenTotal = round1(takenTotal + taken);
    lopTotal = round1(lopTotal + lop);

    // Months before joining or after leaving contribute nothing, so they are
    // left out of the statement rather than shown as empty rows.
    if (onPayroll) rows.push({ month, credit, taken, unpaid, lop, closing: running });
  }

  const pending = input.requests
    .filter((r) => r.status === 'Pending' && r.leaveType !== 'Unpaid')
    .reduce((sum, r) => sum + r.days, 0);

  const lastLeaveOn =
    approved.length > 0
      ? approved.reduce(
          (latest, r) => (r.fromDate > latest ? r.fromDate : latest),
          approved[0].fromDate,
        )
      : null;

  return {
    opening,
    credited,
    taken: takenTotal,
    lop: lopTotal,
    pending: round1(pending),
    adjustments: input.adjustments,
    balance: running,
    available: round1(running - pending),
    rows,
    lastLeaveOn,
  };
}

/**
 * What a proposed request would cost, by running the same simulation with the
 * request added. Returns the extra loss of pay it would create and the balance
 * it would leave behind — the only honest answer, because whether a day is paid
 * now depends on the month it falls in, not on today's balance alone.
 */
export function projectRequest(
  input: LedgerInput,
  proposed: LeaveRequestRecord,
): { lopDays: number; balanceAfter: number; paidDays: number } {
  // Walk far enough to reach the request. Leave booked for a future month is
  // only credited and deducted once the simulation gets there — without this a
  // request wholly in a later month would appear to cost nothing.
  const horizon =
    monthKeyOf(proposed.toDate) > input.uptoMonth ? monthKeyOf(proposed.toDate) : input.uptoMonth;

  const before = computeLedger({ ...input, uptoMonth: horizon });
  const after = computeLedger({
    ...input,
    uptoMonth: horizon,
    requests: [...input.requests, { ...proposed, status: 'Approved' }],
  });

  const lopDays = round1(Math.max(0, after.lop - before.lop));
  return {
    lopDays,
    balanceAfter: after.balance,
    paidDays: round1(proposed.days - lopDays),
  };
}

/** Half-days mean one decimal place; floats would drift over a year of sums. */
const round1 = (n: number): number => Math.round(n * 10) / 10;

