import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_RECORD_GROUP, buildBoard, type BoardInput } from './presence.board';
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
