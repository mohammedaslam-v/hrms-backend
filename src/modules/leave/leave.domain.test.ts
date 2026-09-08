import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeLedger,
  leaveYearMonths,
  LeaveRequestRecord,
  projectRequest,
  workingDaysBetween,
} from './leave.domain';

/** The leave year runs January–December, unlike the financial year. */
const YEAR_START = '2026-01-01';

/**
 * Bambinos declares no festival holidays — the 24 days cover everything. The
 * mechanism is retained for a genuine company closure, so it stays tested, but
 * the live calendar is empty.
 */
const NO_HOLIDAYS = new Set<string>();
const SOME_HOLIDAYS = new Set(['2026-08-15']);

const ledger = (over: Partial<Parameters<typeof computeLedger>[0]> = {}) =>
  computeLedger({
    openingLeave: 0,
    carryCap: 30,
    weeklyOff: ['Sun'],
    holidays: NO_HOLIDAYS,
    dateOfJoining: '2024-03-12',
    dateOfLeaving: null,
    yearStart: YEAR_START,
    leavePerMonth: 2,
    uptoMonth: '2026-09',
    requests: [],
    adjustments: 0,
    ...over,
  });

const request = (over: Partial<LeaveRequestRecord> = {}): LeaveRequestRecord => ({
  id: 1,
  ref: 'LV-1001',
  leaveType: 'Earned',
  fromDate: '2026-04-20',
  toDate: '2026-04-21',
  days: 2,
  unpaidDays: 0,
  status: 'Approved',
  ...over,
});

describe('accrual — January to December', () => {
  it('credits 2 days a month from January to the current month', () => {
    // As of September, nine months have been credited: Jan through Sep.
    const l = ledger();
    assert.equal(l.rows.length, 9);
    assert.equal(l.credited, 18);
    assert.equal(l.rows[0].month, '2026-01');
  });

  it('caps a full leave year at 24 days across 12 months', () => {
    assert.equal(ledger({ uptoMonth: '2026-12' }).credited, 24);
    assert.equal(leaveYearMonths(YEAR_START, '2026-12').length, 12);
  });

  it('starts the year in January, not April', () => {
    assert.deepEqual(leaveYearMonths(YEAR_START, '2026-03'), ['2026-01', '2026-02', '2026-03']);
  });

  it('accrues only from the joining month for a mid-year joiner', () => {
    // Joined in July: July, August, September.
    const l = ledger({ dateOfJoining: '2026-07-14' });
    assert.equal(l.credited, 6);
    assert.deepEqual(l.rows.map((r) => r.month), ['2026-07', '2026-08', '2026-09']);
  });

  it('stops crediting after the leaving month', () => {
    const l = ledger({ dateOfLeaving: '2026-06-30' });
    assert.equal(l.credited, 12); // Jan through Jun
  });
});

describe('balance', () => {
  it('is opening + credited - taken', () => {
    const l = ledger({ openingLeave: 4, requests: [request({ days: 5 })] });
    assert.equal(l.balance, 17); // 4 + 18 - 5
  });

  it('does not deduct unpaid leave from the balance', () => {
    const l = ledger({
      openingLeave: 1,
      requests: [
        request({ days: 2 }),
        request({ id: 2, leaveType: 'Unpaid', days: 5, unpaidDays: 5 }),
      ],
    });
    assert.equal(l.balance, 17); // 1 + 18 - 2; the 5 unpaid days cut salary instead
    assert.equal(l.lop, 5);
  });

  it('exposes available as balance minus pending', () => {
    const l = ledger({
      openingLeave: 2,
      requests: [request({ days: 2 }), request({ id: 2, status: 'Pending', days: 2 })],
    });
    assert.equal(l.balance, 18); // 2 + 18 - 2
    assert.equal(l.pending, 2);
    assert.equal(l.available, 16);
  });

  it('caps the opening balance at the carry-forward limit', () => {
    const l = ledger({ openingLeave: 44, carryCap: 30 });
    assert.equal(l.opening, 30);
    assert.equal(l.balance, 48); // 30 + 18 credited
  });

  it('leaves an opening balance under the cap untouched', () => {
    assert.equal(ledger({ openingLeave: 4, carryCap: 30 }).opening, 4);
  });

  it('ignores rejected and cancelled requests', () => {
    const l = ledger({
      requests: [
        request({ id: 1, status: 'Rejected', days: 3 }),
        request({ id: 2, status: 'Cancelled', days: 4 }),
      ],
    });
    assert.equal(l.balance, 18);
  });

  it('applies signed adjustments', () => {
    assert.equal(ledger({ adjustments: -3 }).balance, 15);
  });
});

describe('working days in a request', () => {
  it("skips the employee's weekly off", () => {
    // Fri 24 Apr to Mon 27 Apr, off on Sunday -> 3 days, not 4.
    assert.equal(workingDaysBetween('2026-04-24', '2026-04-27', ['Sun'], NO_HOLIDAYS), 3);
  });

  it('counts a festival day as leave, since no holidays are declared', () => {
    // 15 Aug falls on a Saturday in 2026. For someone off only on Sunday it is a
    // working day, and taking it off is deducted from the 24.
    assert.equal(workingDaysBetween('2026-08-15', '2026-08-15', ['Sun'], NO_HOLIDAYS), 1);
  });

  it('still skips a declared closure if HR ever adds one', () => {
    assert.equal(workingDaysBetween('2026-08-15', '2026-08-15', ['Sun'], SOME_HOLIDAYS), 0);
  });

  it('counts a single working day as one', () => {
    assert.equal(workingDaysBetween('2026-04-20', '2026-04-20', ['Sun'], NO_HOLIDAYS), 1);
  });

  it('returns zero when the range is only weekly offs', () => {
    assert.equal(workingDaysBetween('2026-04-04', '2026-04-05', ['Sat', 'Sun'], NO_HOLIDAYS), 0);
  });

  it('a half day applies to every working day in the range', () => {
    // Mon 14 to Fri 18 Sep = 5 working days. At half a day each that is 2.5,
    // not 0.5 for the whole request.
    const working = workingDaysBetween('2026-09-14', '2026-09-18', ['Sun'], NO_HOLIDAYS);
    assert.equal(working, 5);
    assert.equal(working * 0.5, 2.5);
  });

  it('returns zero for a reversed range', () => {
    assert.equal(workingDaysBetween('2026-04-10', '2026-04-01', [], NO_HOLIDAYS), 0);
  });
});

describe('loss of pay — confirmed policy', () => {
  /**
   * Balance 4 in September (opening 2 + September's credit 2), 6 days taken
   * wholly within September.
   */
  const sixDaysInSeptember = (uptoMonth: string) =>
    computeLedger({
      openingLeave: 2,
      carryCap: 30,
      weeklyOff: ['Sun'],
      holidays: NO_HOLIDAYS,
      dateOfJoining: '2026-09-01',
      dateOfLeaving: null,
      yearStart: '2026-01-01',
      leavePerMonth: 2,
      uptoMonth,
      adjustments: 0,
      // Mon 14 Sep to Mon 21 Sep, Sunday off -> 6 working days
      requests: [
        {
          id: 1,
          ref: 'LV-1',
          leaveType: 'Earned',
          fromDate: '2026-09-14',
          toDate: '2026-09-21',
          days: 6,
          unpaidDays: 0,
          status: 'Approved',
        },
      ],
    });

  it('CASE 1 — 4 days covered, 2 become loss of pay, September closes at zero', () => {
    const l = sixDaysInSeptember('2026-09');
    assert.equal(l.taken, 6);
    assert.equal(l.lop, 2);
    // Not -2: the 2 short days are deducted from salary, which settles them.
    assert.equal(l.balance, 0);
    assert.equal(l.rows.at(-1)?.lop, 2);
  });

  it("CASE 1 — October is independent: its 2 credits are not eaten by September's LOP", () => {
    const l = sixDaysInSeptember('2026-10');
    assert.equal(l.balance, 2); // 0 carried in + 2 credited, not 0
    assert.equal(l.lop, 2); // September's loss of pay is not counted twice
    assert.equal(l.rows.at(-1)?.lop, 0); // October itself incurs none
  });

  it('CASE 1 — the balance keeps building normally after the LOP month', () => {
    assert.equal(sixDaysInSeptember('2026-11').balance, 4);
    assert.equal(sixDaysInSeptember('2026-11').lop, 2);
  });

  it('CASE 1 — a LOP month is never charged twice as the year runs on', () => {
    // The 2 short days are deducted from September's salary once. Walking
    // further into the year must not keep re-reporting them.
    for (const upto of ['2026-09', '2026-10', '2026-11', '2026-12']) {
      assert.equal(sixDaysInSeptember(upto).lop, 2, `lop drifted by ${upto}`);
    }
  });

  it('a negative adjustment reduces the balance and is not treated as loss of pay', () => {
    // Encashment, lapse and corrections are administrative. Only leave taken
    // beyond the balance costs pay, so a negative adjustment must not be
    // swallowed by the floor-at-zero rule.
    const l = ledger({ adjustments: -3 });
    assert.equal(l.lop, 0);
    assert.equal(l.balance, 15);
  });

  it('CASE 2 — leave spanning two months is judged month by month, no loss of pay', () => {
    const l = computeLedger({
      openingLeave: 2,
      carryCap: 30,
      weeklyOff: ['Sun'],
      holidays: NO_HOLIDAYS,
      dateOfJoining: '2026-09-01',
      dateOfLeaving: null,
      yearStart: '2026-01-01',
      leavePerMonth: 2,
      uptoMonth: '2026-10',
      adjustments: 0,
      // Sun 27 Sep is an off day: 28, 29, 30 Sep + 1, 2 Oct = 5 working days
      requests: [
        {
          id: 1,
          ref: 'LV-2',
          leaveType: 'Earned',
          fromDate: '2026-09-27',
          toDate: '2026-10-02',
          days: 5,
          unpaidDays: 0,
          status: 'Approved',
        },
      ],
    });
    // September: 2 opening + 2 credit - 3 taken = 1
    // October:   1 + 2 credit - 2 taken = 1
    assert.equal(l.lop, 0);
    assert.equal(l.balance, 1);
  });

  it('days a person chose as Unpaid are loss of pay and never touch the balance', () => {
    const l = ledger({
      openingLeave: 4,
      requests: [
        request({ leaveType: 'Unpaid', fromDate: '2026-04-20', toDate: '2026-04-22', days: 3 }),
      ],
    });
    assert.equal(l.lop, 3);
    assert.equal(l.taken, 0);
    assert.equal(l.balance, 22); // 4 + 18 credited, untouched
  });

  it('projects a request booked for a future month, not just the current one', () => {
    const base = {
      openingLeave: 0,
      carryCap: 30,
      weeklyOff: ['Sun'],
      holidays: NO_HOLIDAYS,
      dateOfJoining: '2026-09-01',
      dateOfLeaving: null,
      yearStart: '2026-01-01',
      leavePerMonth: 2,
      uptoMonth: '2026-09', // today is September
      adjustments: 0,
      requests: [],
    };
    // 5 working days in October. September credits 2, October credits 2 more.
    const projected = projectRequest(base, {
      id: 0,
      ref: '',
      leaveType: 'Earned',
      fromDate: '2026-10-05',
      toDate: '2026-10-09',
      days: 5,
      unpaidDays: 0,
      status: 'Pending',
    });
    assert.equal(projected.paidDays, 4); // 2 from September + 2 from October
    assert.equal(projected.lopDays, 1);
    assert.equal(projected.balanceAfter, 0); // the short day is LOP, not a debt
  });

  it('projects what a proposed request would cost before it is submitted', () => {
    const base = {
      openingLeave: 2,
      carryCap: 30,
      weeklyOff: ['Sun'],
      holidays: NO_HOLIDAYS,
      dateOfJoining: '2026-09-01',
      dateOfLeaving: null,
      yearStart: '2026-01-01',
      leavePerMonth: 2,
      uptoMonth: '2026-09',
      adjustments: 0,
      requests: [],
    };
    const projected = projectRequest(base, {
      id: 0,
      ref: '',
      leaveType: 'Earned',
      fromDate: '2026-09-14',
      toDate: '2026-09-21',
      days: 6,
      unpaidDays: 0,
      status: 'Pending',
    });
    assert.equal(projected.paidDays, 4);
    assert.equal(projected.lopDays, 2);
    assert.equal(projected.balanceAfter, 0);
  });
});
