import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  elapsedPct,
  goalProgress,
  goalStatus,
  periodWindow,
  type GoalRecord,
  type Milestone,
} from './goals.domain';

const FY_START = '2026-04-01';
const TOLERANCE = 20;

const goal = (over: Partial<GoalRecord> = {}): GoalRecord => ({
  id: 1,
  ref: 'GL-0001',
  employeeId: 336,
  title: 'A goal',
  goalType: 'metric',
  fy: '2026-27',
  period: 'Q2',
  targetValue: 100,
  currentValue: 0,
  unit: null,
  direction: 'up',
  note: null,
  milestones: [],
  ...over,
});

const miles = (...done: boolean[]): Milestone[] =>
  done.map((isDone, i) => ({ id: i + 1, title: `Step ${i + 1}`, isDone, sortOrder: i }));

describe('period windows', () => {
  it('lays the quarters across the financial year, not the calendar year', () => {
    assert.deepEqual(periodWindow('Q1', FY_START), {
      from: '2026-04-01', to: '2026-06-30', label: 'Q1 · Apr–Jun',
    });
    assert.deepEqual(periodWindow('Q2', FY_START), {
      from: '2026-07-01', to: '2026-09-30', label: 'Q2 · Jul–Sep',
    });
    assert.deepEqual(periodWindow('Q3', FY_START), {
      from: '2026-10-01', to: '2026-12-31', label: 'Q3 · Oct–Dec',
    });
  });

  it('runs Q4 into the NEXT calendar year', () => {
    // The trap: Q4 of FY 2026-27 is Jan–Mar 2027, not Jan–Mar 2026.
    assert.deepEqual(periodWindow('Q4', FY_START), {
      from: '2027-01-01', to: '2027-03-31', label: 'Q4 · Jan–Mar',
    });
  });

  it('spans the year boundary for H2', () => {
    assert.deepEqual(periodWindow('H2', FY_START), {
      from: '2026-10-01', to: '2027-03-31', label: 'H2 · Oct–Mar',
    });
  });

  it('covers the whole year for H1 and FY', () => {
    assert.deepEqual(periodWindow('H1', FY_START), {
      from: '2026-04-01', to: '2026-09-30', label: 'H1 · Apr–Sep',
    });
    assert.deepEqual(periodWindow('FY', FY_START), {
      from: '2026-04-01', to: '2027-03-31', label: 'Full year · Apr–Mar',
    });
  });

  it('is derived from the configured start, not hardcoded to one year', () => {
    const later = periodWindow('Q1', '2030-04-01');
    assert.equal(later.from, '2030-04-01');
    assert.equal(later.to, '2030-06-30');
  });

  it('handles a leap year in the window it ends on', () => {
    // FY 2027-28: Q4 ends 31 Mar 2028, and February 2028 has 29 days.
    assert.equal(periodWindow('Q4', '2027-04-01').to, '2028-03-31');
  });

  it('would follow the company if it moved its financial year', () => {
    const jan = periodWindow('Q1', '2026-01-01');
    assert.deepEqual(jan, { from: '2026-01-01', to: '2026-03-31', label: 'Q1 · Jan–Mar' });
  });
});

describe('progress — a number to hit', () => {
  it('is current over target when higher is better', () => {
    assert.equal(goalProgress(goal({ currentValue: 40, targetValue: 100 })), 40);
    assert.equal(goalProgress(goal({ currentValue: 100, targetValue: 100 })), 100);
  });

  it('never exceeds 100, however far past the target', () => {
    assert.equal(goalProgress(goal({ currentValue: 250, targetValue: 100 })), 100);
  });

  it('is target over current when LOWER is better', () => {
    // The rule people get wrong: keep CAC under 1400, currently 1520.
    // 1400 / 1520 = 92%. A naive current/target would say 109%.
    assert.equal(
      goalProgress(goal({ direction: 'down', targetValue: 1400, currentValue: 1520 })),
      92,
    );
    assert.equal(goalProgress(goal({ direction: 'down', targetValue: 300, currentValue: 410 })), 73);
  });

  it('is complete once a "lower is better" goal is at or under target', () => {
    assert.equal(goalProgress(goal({ direction: 'down', targetValue: 300, currentValue: 250 })), 100);
    assert.equal(goalProgress(goal({ direction: 'down', targetValue: 300, currentValue: 300 })), 100);
  });

  it('treats zero as complete on a "lower is better" goal', () => {
    // "Zero escaped defects" is achieved at zero — and dividing by it is not.
    assert.equal(goalProgress(goal({ direction: 'down', targetValue: 0, currentValue: 0 })), 100);
    assert.equal(goalProgress(goal({ direction: 'down', targetValue: 5, currentValue: 0 })), 100);
  });

  it('is zero rather than an error when the goal is unusable', () => {
    assert.equal(goalProgress(goal({ targetValue: null })), 0);
    assert.equal(goalProgress(goal({ targetValue: 0, currentValue: 50 })), 0);
    assert.equal(goalProgress(goal({ currentValue: null })), 0);
  });

  it('never goes negative', () => {
    assert.equal(goalProgress(goal({ currentValue: -40, targetValue: 100 })), 0);
  });
});

describe('progress — a checklist', () => {
  const list = (m: Milestone[]) => goal({ goalType: 'milestone', targetValue: null, milestones: m });

  it('is the share of milestones ticked off', () => {
    assert.equal(goalProgress(list(miles(true, true, false, false))), 50);
    assert.equal(goalProgress(list(miles(true, false, false))), 33);
    assert.equal(goalProgress(list(miles(true, true, true))), 100);
  });

  it('is zero when nothing is ticked', () => {
    assert.equal(goalProgress(list(miles(false, false))), 0);
  });

  it('is zero, not a division by zero, when there are no milestones', () => {
    assert.equal(goalProgress(list([])), 0);
  });
});

describe('status', () => {
  const q2 = periodWindow('Q2', FY_START); // 2026-07-01 to 2026-09-30

  it('is Achieved at 100%, whatever the date', () => {
    const done = goal({ currentValue: 100 });
    assert.equal(goalStatus(done, q2, '2026-07-02', TOLERANCE), 'Achieved');
    // Finishing late is still finishing — not Missed.
    assert.equal(goalStatus(done, q2, '2027-01-01', TOLERANCE), 'Achieved');
  });

  it('is Not started before the period opens', () => {
    assert.equal(goalStatus(goal({ currentValue: 10 }), q2, '2026-06-30', TOLERANCE), 'Not started');
  });

  it('is Missed after the period closes short of target', () => {
    assert.equal(goalStatus(goal({ currentValue: 90 }), q2, '2026-10-01', TOLERANCE), 'Missed');
  });

  it('compares progress against time elapsed, not a fixed threshold', () => {
    // Halfway through Q2 (about 15 Aug), roughly 50% elapsed.
    const halfway = '2026-08-15';
    // 30% done with 50% gone is 20 points behind — exactly the tolerance, so not yet at risk.
    assert.equal(goalStatus(goal({ currentValue: 30 }), q2, halfway, TOLERANCE), 'On track');
    // 20% done is 30 points behind.
    assert.equal(goalStatus(goal({ currentValue: 20 }), q2, halfway, TOLERANCE), 'At risk');
  });

  it('does not call the same progress at risk in week one', () => {
    // 30% in the first week is ahead of time elapsed, not behind it.
    assert.equal(goalStatus(goal({ currentValue: 30 }), q2, '2026-07-05', TOLERANCE), 'On track');
  });

  it('follows the configured tolerance rather than a constant', () => {
    const halfway = '2026-08-15';
    const behind = goal({ currentValue: 20 });
    assert.equal(goalStatus(behind, q2, halfway, 20), 'At risk');
    // A more forgiving policy makes the same goal on track.
    assert.equal(goalStatus(behind, q2, halfway, 40), 'On track');
  });

  it('reads a checklist the same way', () => {
    const half = goal({ goalType: 'milestone', targetValue: null, milestones: miles(true, false) });
    assert.equal(goalStatus(half, q2, '2026-07-05', TOLERANCE), 'On track');
    assert.equal(goalStatus(half, q2, '2026-09-29', TOLERANCE), 'At risk');
  });
});

describe('elapsed share of a period', () => {
  const q2 = periodWindow('Q2', FY_START);

  it('is zero on the first day and 100 on the last', () => {
    assert.equal(elapsedPct(q2, '2026-07-01'), 0);
    assert.equal(elapsedPct(q2, '2026-09-30'), 100);
  });

  it('is about half at the midpoint', () => {
    const mid = elapsedPct(q2, '2026-08-15');
    assert.ok(mid >= 48 && mid <= 52, `expected about half, got ${mid}`);
  });

  it('clamps outside the period rather than going negative or past 100', () => {
    assert.equal(elapsedPct(q2, '2026-01-01'), 0);
    assert.equal(elapsedPct(q2, '2027-01-01'), 100);
  });
});
