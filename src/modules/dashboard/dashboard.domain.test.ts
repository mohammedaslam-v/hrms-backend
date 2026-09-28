import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AttendanceStatus, DayAttendance } from '../attendance/attendance.domain';
import {
  attentionItems,
  departmentHours,
  isPresent,
  kpisOf,
  namesSummary,
  type PersonDay,
} from './dashboard.domain';

const day = (status: AttendanceStatus, activeHours = 0): DayAttendance => ({
  date: '2026-09-25',
  status,
  loginAt: null,
  logoutAt: null,
  activeHours,
  lateByMinutes: 0,
  segments: [],
  source: 'punch',
});

const person = (
  name: string,
  status: AttendanceStatus,
  hours = 0,
  department: string | null = 'Tech',
): PersonDay => ({ employeeId: name.length, name, department, day: day(status, hours) });

describe('who counts as present', () => {
  it('counts a half day — they worked', () => {
    assert.equal(isPresent('Half day'), true);
    assert.equal(isPresent('On time'), true);
    assert.equal(isPresent('Late'), true);
  });

  it('does not count a day that has not finished', () => {
    // The trap: counting 'Not in yet' as present inflates the morning figure,
    // and counting it absent libels everybody before lunch.
    assert.equal(isPresent('Not in yet'), false);
  });

  it('does not count leave, weekly offs or holidays', () => {
    for (const s of ['Leave', 'Weekly off', 'Holiday', 'Absent'] as AttendanceStatus[]) {
      assert.equal(isPresent(s), false, `${s} should not count as present`);
    }
  });
});

describe('the five figures', () => {
  const roster = [
    person('Aaliya Lokhandwala', 'On time', 8),
    person('Harish Kumar', 'Late', 6),
    person('Ananya N', 'Absent'),
    person('Arti Sharma', 'Leave'),
    person('Nakul Sharma', 'Not in yet'),
    person('Vinita Routh', 'Weekly off'),
  ];

  it('counts headcount as everyone in scope, whatever their day', () => {
    assert.equal(kpisOf(roster).headcount, 6);
  });

  it('counts late people as both logged in and late', () => {
    const k = kpisOf(roster);
    assert.equal(k.loggedIn, 2); // On time + Late
    assert.equal(k.late, 1);
  });

  it('counts only a FINISHED empty day as no-login', () => {
    // 'Not in yet' and 'Weekly off' are both empty and neither is an absence.
    assert.equal(kpisOf(roster).noLogin, 1);
  });

  it('counts a half day as both present and on leave', () => {
    // It is genuinely both, and the design shows it in both cards.
    const k = kpisOf([person('Half Person', 'Half day', 4)]);
    assert.equal(k.loggedIn, 1);
    assert.equal(k.onLeave, 1);
  });

  it('is all zeroes for an empty roster rather than throwing', () => {
    assert.deepEqual(kpisOf([]), {
      headcount: 0, loggedIn: 0, late: 0, noLogin: 0, onLeave: 0,
    });
  });
});

describe('active hours by department', () => {
  it('sums each department and sorts by the busiest', () => {
    const rows = departmentHours([
      person('A A', 'On time', 3, 'Sales'),
      person('B B', 'On time', 5, 'Tech'),
      person('C C', 'On time', 2, 'Sales'),
    ]);
    assert.deepEqual(rows.map((r) => [r.department, r.hours]), [
      ['Sales', 5],
      ['Tech', 5],
    ]);
  });

  it('gives the busiest department a full bar', () => {
    const rows = departmentHours([
      person('A A', 'On time', 8, 'Tech'),
      person('B B', 'On time', 2, 'Sales'),
    ]);
    assert.equal(rows[0].percent, 100);
    assert.equal(rows[1].percent, 25);
  });

  it('gathers people with no department rather than dropping them', () => {
    // At Bambinos almost nobody has a department set. Dropping them would make
    // the chart claim the company did no work today.
    const rows = departmentHours([person('A A', 'On time', 4, null)]);
    assert.deepEqual(rows, [{ department: 'No department set', hours: 4, percent: 100 }]);
  });

  it('leaves out people who logged no hours', () => {
    assert.deepEqual(departmentHours([person('A A', 'Absent', 0, 'Tech')]), []);
  });

  it('does not divide by zero when nobody worked', () => {
    assert.deepEqual(departmentHours([]), []);
  });
});

describe('needs your attention', () => {
  const base = { people: [], pendingApprovals: 0, goalsAtRisk: [] };

  it('is empty when there is nothing to decide', () => {
    assert.deepEqual(attentionItems(base), []);
  });

  it('leads with approvals, because only they are blocking somebody', () => {
    const items = attentionItems({
      ...base,
      pendingApprovals: 3,
      people: [person('Late One', 'Late')],
    });
    assert.equal(items[0].kind, 'approvals');
    assert.equal(items[0].title, '3 leave requests waiting on you');
  });

  it('says "1 leave request", not "1 leave requests"', () => {
    const items = attentionItems({ ...base, pendingApprovals: 1 });
    assert.equal(items[0].title, '1 leave request waiting on you');
  });

  it('does not link the attendance items — that page does not exist yet', () => {
    const items = attentionItems({
      ...base,
      people: [person('Late One', 'Late'), person('Missing Two', 'Absent')],
    });
    const late = items.find((i) => i.kind === 'late');
    const none = items.find((i) => i.kind === 'no-login');
    assert.equal(late?.goTo, null);
    assert.equal(none?.goTo, null);
    // ... while the ones whose screens exist do link.
    assert.equal(attentionItems({ ...base, pendingApprovals: 1 })[0].goTo, 'leave');
  });

  it('names a few people rather than all of them', () => {
    const many = ['Aaliya X', 'Harish Y', 'Ananya Z', 'Arti Q', 'Nakul R']
      .map((n) => person(n, 'Absent'));
    const items = attentionItems({ ...base, people: many });
    assert.equal(items[0].detail, 'Aaliya, Harish, Ananya and 2 more');
  });
});

describe('name summaries', () => {
  it('lists everyone when the list is short', () => {
    assert.equal(namesSummary([person('Aaliya X', 'Late'), person('Harish Y', 'Late')]), 'Aaliya, Harish');
  });

  it('uses first names only', () => {
    assert.equal(namesSummary([person('Aaliya Lokhandwala', 'Late')]), 'Aaliya');
  });

  it('is empty for nobody', () => {
    assert.equal(namesSummary([]), '');
  });
});
