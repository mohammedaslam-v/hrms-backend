import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nightShiftDays } from './presence.night';

const h = (hourStart: string, lastSeenAt: string, activeSeconds: number) => ({ hourStart, lastSeenAt, activeSeconds });

// 21:00–07:00. The 13 Nov calendar row holds the 12 Nov night's tail and the
// 13 Nov evening together — the case the calendar-day figures got wrong.
const dayRows = [
  { date: '2026-11-12', firstSeen: '20:50', lastSeen: '23:59', activeSeconds: 7000, sessions: 2 },
  { date: '2026-11-13', firstSeen: '00:00', lastSeen: '23:30', activeSeconds: 20000, sessions: 3 },
];
const hours = [
  h('2026-11-12 20:00', '2026-11-12 20:59', 300),
  h('2026-11-12 23:00', '2026-11-12 23:59', 3000),
  h('2026-11-13 02:00', '2026-11-13 02:40', 1800),
  h('2026-11-13 06:00', '2026-11-13 06:58', 2400),
  h('2026-11-13 21:00', '2026-11-13 21:30', 1200), // the 13 Nov night
];

test('a night shift takes its own hours across midnight, each hour once', () => {
  const out = nightShiftDays(['2026-11-12', '2026-11-13'], '21:00', '07:00', dayRows, hours);
  assert.deepEqual(out, [
    { date: '2026-11-12', firstSeen: '20:54', lastSeen: '06:58', activeSeconds: 7500, sessions: 2 },
    { date: '2026-11-13', firstSeen: '21:10', lastSeen: '21:30', activeSeconds: 1200, sessions: 3 },
  ]);
});

test('nights before the hourly data was complete keep the calendar-day figure', () => {
  const old = [{ date: '2026-11-10', firstSeen: '20:00', lastSeen: '23:59', activeSeconds: 9000, sessions: 1 }];
  assert.deepEqual(nightShiftDays(['2026-11-10', '2026-11-11'], '21:00', '07:00', old, []), old);
});

test('a shift date with no hours in its window has no row', () => {
  assert.deepEqual(nightShiftDays(['2026-11-14'], '21:00', '07:00', [], hours), []);
});
