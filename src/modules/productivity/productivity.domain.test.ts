import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  REQUIRED_MINUTES,
  activityMinutesFor,
  isMet,
  isProductivityRuled,
  reasonFor,
  skipReason,
  windowFor,
  type DayFacts,
} from './productivity.domain';

test('90% of 9 hours is 8h 06m', () => {
  assert.equal(REQUIRED_MINUTES, 486);
  assert.equal(isMet({ panelMinutes: 240, activityMinutes: 180 }), false); // 7h
  assert.equal(isMet({ panelMinutes: 306, activityMinutes: 180 }), true); // 8h 06m
});

test('Sales only, from 10 Nov 2026 — Presales stays out', () => {
  assert.equal(isProductivityRuled('Sales', '2026-11-10'), true);
  assert.equal(isProductivityRuled(' sales ', '2026-12-01'), true);
  assert.equal(isProductivityRuled('Sales', '2026-11-09'), false);
  assert.equal(isProductivityRuled('Presales', '2026-11-10'), false);
  assert.equal(isProductivityRuled('Tech', '2026-11-10'), false);
});

test('a day shift is decided 4 hours after it ends and counts its calendar day', () => {
  assert.deepEqual(windowFor('2026-11-10', '10:00', '19:00'), {
    night: false,
    from: '2026-11-10 00:00',
    decideAt: '2026-11-10 23:00',
  });
  // Ending late: the grace runs past midnight.
  assert.equal(windowFor('2026-11-10', '13:00', '22:00').decideAt, '2026-11-11 02:00');
});

test('a night shift belongs to its start date and is counted across midnight', () => {
  assert.deepEqual(windowFor('2026-11-10', '21:00', '06:00'), {
    night: true,
    from: '2026-11-10 15:00',
    decideAt: '2026-11-11 10:00',
  });
});

const act = (date: string, startTime: string, endTime: string) => ({ date, startTime, endTime });

test('activities: a day shift takes its date in full, a night shift its window', () => {
  const day = windowFor('2026-11-10', '10:00', '19:00');
  assert.equal(
    activityMinutesFor('2026-11-10', day, [act('2026-11-10', '10:00', '10:22'), act('2026-11-10', '21:00', '21:30'), act('2026-11-11', '10:00', '11:00')]),
    52,
  );

  const night = windowFor('2026-11-10', '21:00', '06:00');
  assert.equal(
    activityMinutesFor('2026-11-10', night, [
      act('2026-11-10', '14:30', '15:30'), // half inside: 30
      act('2026-11-10', '22:00', '23:00'), // 60
      act('2026-11-11', '02:00', '02:45'), // after midnight, same night: 45
      act('2026-11-11', '16:00', '17:00'), // the next night's window: 0
    ]),
    135,
  );
});

const facts = (over: Partial<DayFacts> = {}): DayFacts => ({
  date: '2026-11-10', // Tuesday
  dateOfJoining: '2026-01-01',
  dateOfLeaving: null,
  weeklyOff: ['Sun'],
  holiday: false,
  leave: null,
  record: null,
  ...over,
});

test('leave, weekly off, holidays and admin edits are left alone', () => {
  assert.equal(skipReason(facts()), null);
  assert.equal(skipReason(facts({ weeklyOff: ['Tue'] })), 'weekly off');
  assert.equal(skipReason(facts({ record: { source: 'manual', status: 'Weekly off' } })), 'weekly off');
  // A usual off day made a working day by hand (manual Absent) is decided.
  assert.equal(skipReason(facts({ weeklyOff: ['Tue'], record: { source: 'manual', status: 'Absent' } })), null);
  assert.equal(skipReason(facts({ leave: 'Approved' })), 'on leave');
  assert.equal(skipReason(facts({ leave: 'Pending' })), 'leave pending');
  assert.equal(skipReason(facts({ holiday: true })), 'holiday');
  assert.equal(skipReason(facts({ record: { source: 'manual', status: 'On time' } })), 'edited by admin');
  assert.equal(skipReason(facts({ record: { source: 'app', status: 'Late' } })), null);
  assert.equal(skipReason(facts({ dateOfJoining: '2026-11-11' })), 'not employed');
});

test('the reason names the figures and the result', () => {
  assert.equal(
    reasonFor({ panelMinutes: 240, activityMinutes: 180 }, 'earned'),
    'Productivity below 90%: 7h 00m productive (panels 4h 00m + activities 3h 00m), 8h 06m needed. Marked as earned leave (EL).',
  );
  assert.match(reasonFor({ panelMinutes: 240, activityMinutes: 0 }, 'unpaid'), /loss of pay \(LOP\) — no leave balance/);
});
