import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_RECORD_GROUP, buildBoard, shiftNow, type BoardInput } from './presence.board';
import { LatestPresenceRow } from './presence.model';

const seen = (secondsAgo: number, over: Partial<LatestPresenceRow> = {}): LatestPresenceRow => ({
  last_path: '/tickets',
  seconds_ago: secondsAgo,
  session_minutes: 12,
  signed_off: 0,
  last_seen_ist: '2026-10-18 11:00',
  ...over,
});

const input = (over: Partial<BoardInput> = {}): BoardInput => ({
  today: '2026-10-18',
  viewerId: 1,
  viewerAdminIds: [101],
  members: [
    { employeeId: 1, name: 'Asha', designation: 'Lead', department: 'Sales', shiftStart: '10:00:00', shiftEnd: '19:00:00' },
    { employeeId: 2, name: 'Bala', designation: null, department: 'Sales', shiftStart: '10:00', shiftEnd: '19:00' },
    { employeeId: 3, name: 'Chetan', designation: null, department: 'Sales', shiftStart: '16:00', shiftEnd: '23:00' },
    { employeeId: 4, name: 'Devi', designation: null, department: 'Sales', shiftStart: '07:00', shiftEnd: '16:00' },
    { employeeId: 5, name: 'Esha', designation: null, department: 'Sales', shiftStart: '10:00', shiftEnd: '19:00' },
  ],
  adminOf: new Map([[1, 101], [2, 102], [3, 103], [5, 105]]),
  roleOf: new Map([[101, 'TECH']]),
  latest: new Map([
    [101, seen(900)],
    [102, seen(20)],
    [103, seen(30)],
  ]),
  leaveOf: new Map([[5, { type: 'Earned', isHalfDay: false }]]),
  unlinked: [],
  now: new Date('2026-10-18T06:00:00Z'),
  ...over,
});

test('groups by shift, earliest start first, and HH:MM keys', () => {
  const b = buildBoard(input());
  assert.deepEqual(b.groups.map((g) => g.key), ['07:00–16:00', '10:00–19:00', '16:00–23:00']);
});

test('someone online outside their shift hours still shows online, in their own group', () => {
  const b = buildBoard(input());
  const late = b.groups.find((g) => g.key === '16:00–23:00')!;
  assert.equal(late.people[0].presence?.status, 'online');
  assert.equal(late.online, 1);
});

test('within a shift: online first, then most recent, then never seen', () => {
  const b = buildBoard(input());
  const day = b.groups.find((g) => g.key === '10:00–19:00')!;
  assert.deepEqual(day.people.map((p) => p.name), ['Bala', 'Asha', 'Esha']);
  assert.equal(day.people[1].presence?.status, 'away');
  assert.equal(day.people[2].presence, null);
});

test('leave today is carried for the row; counts cover every group', () => {
  const b = buildBoard(input());
  const esha = b.groups.flatMap((g) => g.people).find((p) => p.name === 'Esha')!;
  assert.deepEqual(esha.leave, { type: 'Earned', isHalfDay: false });
  assert.deepEqual(b.counts, { online: 2, people: 5 });
});

test('the viewer is marked; never-linked employees still appear', () => {
  const b = buildBoard(input());
  const people = b.groups.flatMap((g) => g.people);
  assert.equal(people.find((p) => p.employeeId === 1)?.isMe, true);
  assert.equal(people.find((p) => p.employeeId === 4)?.adminId, null);
});

test('no-record admins go last, in their own group', () => {
  const b = buildBoard(input({
    unlinked: [{ ...seen(10), admin_id: 900, name: 'Ops Desk', role: 'CSR' }],
  }));
  const last = b.groups[b.groups.length - 1];
  assert.equal(last.key, NO_RECORD_GROUP);
  assert.equal(last.shiftStart, null);
  assert.equal(last.people[0].subtitle, 'CSR');
  assert.equal(b.counts.online, 3);
});

test('a logged-out person is not counted online', () => {
  const b = buildBoard(input({ latest: new Map([[102, seen(20, { signed_off: 1 })]]) }));
  assert.equal(b.counts.online, 0);
});

test('the grey label is the admin role, else the HRMS department', () => {
  const people = buildBoard(input()).groups.flatMap((g) => g.people);
  assert.equal(people.find((p) => p.employeeId === 1)?.team, 'TECH');
  assert.equal(people.find((p) => p.employeeId === 2)?.team, 'Sales');
  assert.equal(people.find((p) => p.employeeId === 4)?.team, 'Sales');
});

test('a day shift runs from its start up to, not including, its end', () => {
  assert.deepEqual(shiftNow('10:00', '19:00', '2026-10-18', '10:00'), { shiftDate: '2026-10-18', minutesIn: 0 });
  assert.deepEqual(shiftNow('10:00:00', '19:00:00', '2026-10-18', '18:59'), { shiftDate: '2026-10-18', minutesIn: 539 });
  assert.equal(shiftNow('10:00', '19:00', '2026-10-18', '19:00'), null);
  assert.equal(shiftNow('10:00', '19:00', '2026-10-18', '09:59'), null);
});

test('a night shift after midnight belongs to the day it started', () => {
  assert.deepEqual(shiftNow('22:00', '06:00', '2026-10-18', '23:30'), { shiftDate: '2026-10-18', minutesIn: 90 });
  assert.deepEqual(shiftNow('22:00', '06:00', '2026-10-18', '02:00'), { shiftDate: '2026-10-17', minutesIn: 240 });
  assert.equal(shiftNow('22:00', '06:00', '2026-10-18', '12:00'), null);
});

test('on duty = inside the shift, not on weekly off, not on leave', () => {
  // 2026-10-18 is a Sunday. Bala's weekly off is Sunday; Esha is on leave.
  const people = buildBoard(
    input({ time: '11:00', weeklyOffOf: new Map([[2, ['Sun']]]) }),
  ).groups.flatMap((g) => g.people);
  const of = (id: number) => people.find((p) => p.employeeId === id)!;

  assert.equal(of(1).onDuty, true);
  assert.equal(of(1).shiftMinutesIn, 60);
  assert.equal(of(2).onDuty, false);
  assert.equal(of(2).dayOff, 'Weekly off');
  assert.equal(of(3).onDuty, false, '16:00–23:00 has not started at 11:00');
  assert.equal(of(3).shiftMinutesIn, null);
  assert.equal(of(4).onDuty, true);
  assert.equal(of(5).onDuty, false, 'leave takes someone off the expected list');
});

test('a half day of leave is off the expected list too, but keeps its presence', () => {
  const people = buildBoard(
    input({ time: '11:00', leaveOf: new Map([[2, { type: 'Earned', isHalfDay: true }]]) }),
  ).groups.flatMap((g) => g.people);
  const bala = people.find((p) => p.employeeId === 2)!;
  assert.equal(bala.onDuty, false);
  assert.equal(bala.presence?.status, 'online');
});

test('without the clock nobody is on duty, and a holiday is a day off', () => {
  const plain = buildBoard(input()).groups.flatMap((g) => g.people);
  assert.ok(plain.every((p) => !p.onDuty));
  const holiday = buildBoard(input({ time: '11:00', holidayToday: 'Diwali' })).groups.flatMap((g) => g.people);
  assert.ok(holiday.every((p) => !p.onDuty && p.dayOff === 'Holiday'));
});

test('from the admin panel, "you" is matched by admin account, not employee', () => {
  const people = buildBoard(input({ viewerId: 0, viewerAdminIds: [102] })).groups.flatMap((g) => g.people);
  assert.deepEqual(people.filter((p) => p.isMe).map((p) => p.name), ['Bala']);
});

test("today's admin-panel time is carried per person; no account or no row reads 0", () => {
  const people = buildBoard(input({ activeSecondsOf: new Map([[101, 5400]]) })).groups.flatMap((g) => g.people);
  const of = (id: number) => people.find((p) => p.employeeId === id)!;
  assert.equal(of(1).activeTodaySeconds, 5400);
  assert.equal(of(2).activeTodaySeconds, 0, 'linked but not on the panel today');
  assert.equal(of(4).activeTodaySeconds, 0, 'no admin account');
});

test('night shift active time follows shift window: 6h before start until 4h after end', () => {
  const nightMember = {
    employeeId: 6,
    name: 'Mirnal',
    designation: 'CSR',
    department: 'Sales',
    shiftStart: '21:00',
    shiftEnd: '07:00',
  };
  const activeMap = new Map([
    [106, new Map([['2026-10-17', 7200], ['2026-10-18', 3600]])],
  ]);

  // At 02:00 (during the night shift, after midnight on 2026-10-18):
  // 02:00 is before next shift window start (15:00 = 6h before 21:00), so it belongs to 2026-10-17 shift
  const nightInput = input({
    today: '2026-10-18',
    time: '02:00',
    members: [nightMember],
    adminOf: new Map([[6, 106]]),
    activeSecondsOf: activeMap,
  });
  const atNight = buildBoard(nightInput).groups[0].people[0];
  assert.equal(atNight.activeTodaySeconds, 7200, 'active time should not reset at midnight; shows shift from 2026-10-17');

  // At 11:30 (during daytime before the next 21:00 shift window begins at 15:00):
  const daytimeInput = input({
    today: '2026-10-18',
    time: '11:30',
    members: [nightMember],
    adminOf: new Map([[6, 106]]),
    activeSecondsOf: activeMap,
  });
  const atDaytime = buildBoard(daytimeInput).groups[0].people[0];
  assert.equal(atDaytime.activeTodaySeconds, 7200, 'carries shift active time until next shift window starts at 15:00');

  // At 21:30 (after the new shift window started at 15:00):
  const nextShiftInput = input({
    today: '2026-10-18',
    time: '21:30',
    members: [nightMember],
    adminOf: new Map([[6, 106]]),
    activeSecondsOf: activeMap,
  });
  const atNextShift = buildBoard(nextShiftInput).groups[0].people[0];
  assert.equal(atNextShift.activeTodaySeconds, 3600, 'new shift window resets to today shift only');

  // 16:00–02:00 shift (e.g. Vinit): shift cycle window starts at 10:00 (6h before 16:00)
  const vinitMember = {
    employeeId: 7,
    name: 'Vinit',
    designation: 'Ops',
    department: 'Teacher Ops',
    shiftStart: '16:00',
    shiftEnd: '02:00',
  };
  const vinitMap = new Map([
    [107, new Map([['2026-11-23', 25980], ['2026-11-24', 1200]])], // 25980 = 7h 13m
  ]);

  // At 23:42 on 2026-11-23 (evening of shift):
  const vinitEvening = buildBoard(input({
    today: '2026-11-23',
    time: '23:42',
    members: [vinitMember],
    adminOf: new Map([[7, 107]]),
    activeSecondsOf: vinitMap,
  })).groups[0].people[0];
  assert.equal(vinitEvening.activeTodaySeconds, 25980, 'shows 7h 13m on Monday evening');

  // At 01:30 on 2026-11-24 (after midnight, before 10:00 AM window):
  const vinitLateNight = buildBoard(input({
    today: '2026-11-24',
    time: '01:30',
    members: [vinitMember],
    adminOf: new Map([[7, 107]]),
    activeSecondsOf: vinitMap,
  })).groups[0].people[0];
  assert.equal(vinitLateNight.activeTodaySeconds, 25980, 'still shows Monday shift after midnight');

  // At 10:30 on 2026-11-24 (after 10:00 AM window start):
  const vinitNextCycle = buildBoard(input({
    today: '2026-11-24',
    time: '10:30',
    members: [vinitMember],
    adminOf: new Map([[7, 107]]),
    activeSecondsOf: vinitMap,
  })).groups[0].people[0];
  assert.equal(vinitNextCycle.activeTodaySeconds, 1200, 'switches to Tuesday shift at 10:00 AM');
});

test('night shift shows weekly off between shift end and next shift start', () => {
  const mirnal = {
    employeeId: 6,
    name: 'Mirnal',
    designation: 'CSR',
    department: 'Sales',
    shiftStart: '21:00',
    shiftEnd: '07:00',
  };
  // 2026-10-29 is Thursday (Weekly Off), 2026-10-30 is Friday
  const weeklyOffOf = new Map([[6, ['Thu']]]);

  // Case 1: Friday at 11:30 (yesterday Thursday was weekly off, today's shift starts at 21:00)
  const friDaytime = buildBoard(input({
    today: '2026-10-30',
    time: '11:30',
    members: [mirnal],
    weeklyOffOf,
  })).groups[0].people[0];
  assert.equal(friDaytime.dayOff, 'Weekly off');
  assert.equal(friDaytime.onDuty, false);

  // Case 2: Thursday at 11:30 (Wednesday night shift ended at 07:00, today Thursday is weekly off)
  const thuDaytime = buildBoard(input({
    today: '2026-10-29',
    time: '11:30',
    members: [mirnal],
    weeklyOffOf,
  })).groups[0].people[0];
  assert.equal(thuDaytime.dayOff, 'Weekly off');
  assert.equal(thuDaytime.onDuty, false);

  // Case 3: Friday at 21:30 (Friday night shift is running)
  const friNight = buildBoard(input({
    today: '2026-10-30',
    time: '21:30',
    members: [mirnal],
    weeklyOffOf,
  })).groups[0].people[0];
  assert.equal(friNight.dayOff, null);
  assert.equal(friNight.onDuty, true);
});

test('night shift shows leave across midnight and between shift end and next shift start', () => {
  const mirnal = {
    employeeId: 6,
    name: 'Mirnal',
    designation: 'CSR',
    department: 'Sales',
    shiftStart: '21:00',
    shiftEnd: '07:00',
  };
  // Mirnal has approved leave on 2026-10-29 (Thursday)
  const leaveThu = new Map([[6, { type: 'Earned', isHalfDay: false }]]);
  const leaveFri = new Map<number, { type: string; isHalfDay: boolean }>();

  // Case 1: Thursday at 11:30 (during daytime before 21:00 shift starts, leave on Thursday)
  const thuDaytime = buildBoard(input({
    today: '2026-10-29',
    time: '11:30',
    members: [mirnal],
    leaveTodayOf: leaveThu,
  })).groups[0].people[0];
  assert.deepEqual(thuDaytime.leave, { type: 'Earned', isHalfDay: false });
  assert.equal(thuDaytime.onDuty, false);

  // Case 2: Friday at 02:00 (after midnight, running shift belongs to Thursday 2026-10-29)
  const friNight = buildBoard(input({
    today: '2026-10-30',
    time: '02:00',
    members: [mirnal],
    leaveTodayOf: leaveFri,
    leaveYesterdayOf: leaveThu,
  })).groups[0].people[0];
  assert.deepEqual(friNight.leave, { type: 'Earned', isHalfDay: false });
  assert.equal(friNight.onDuty, false);

  // Case 3: Friday at 11:30 (shift ended at 07:00, daytime between shifts before next shift at 21:00)
  const friDaytime = buildBoard(input({
    today: '2026-10-30',
    time: '11:30',
    members: [mirnal],
    leaveTodayOf: leaveFri,
    leaveYesterdayOf: leaveThu,
  })).groups[0].people[0];
  assert.deepEqual(friDaytime.leave, { type: 'Earned', isHalfDay: false });
  assert.equal(friDaytime.onDuty, false);

  // Case 4: Friday at 21:30 (Friday night shift has started, no leave for Friday)
  const friNextShift = buildBoard(input({
    today: '2026-10-30',
    time: '21:30',
    members: [mirnal],
    leaveTodayOf: leaveFri,
    leaveYesterdayOf: leaveThu,
  })).groups[0].people[0];
  assert.equal(friNextShift.leave, null);
  assert.equal(friNextShift.onDuty, true);
});

