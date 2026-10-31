import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildActiveTimeRows, shiftMinutesOf, type ActiveTimeMember } from './reports.active-time';
import { type AttendanceDay } from './reports.attendance';
import { ReportsService } from './reports.service';

const day = (over: Partial<AttendanceDay>): AttendanceDay => ({
  employeeId: 1,
  date: '2026-10-27',
  dayName: 'Tue',
  shiftStart: '10:00',
  shiftEnd: '19:00',
  loginAt: '10:00',
  logoutAt: '19:00',
  activeHours: 9,
  lateByMinutes: 0,
  status: 'On time',
  fromActivity: false,
  ...over,
});

const member = (id: number, name: string): ActiveTimeMember => ({
  id,
  employeeCode: `E${id}`,
  fullName: name,
  department: 'Sales',
  shiftStart: '10:00:00',
  shiftEnd: '19:00:00',
});

// ── The grid ──────────────────────────────────────────────────────────────

test('each day carries panel time, checked-in time and the status; totals add up hours only', () => {
  const dates = ['2026-10-27', '2026-10-28', '2026-10-29'];
  const attendance = new Map([
    [
      1,
      new Map([
        ['2026-10-27', day({})],
        ['2026-10-28', day({ date: '2026-10-28', status: 'Leave', loginAt: null, logoutAt: null, activeHours: 0 })],
        ['2026-10-29', day({ date: '2026-10-29', status: 'Weekly off', loginAt: null, logoutAt: null, activeHours: 0 })],
      ]),
    ],
  ]);
  const panel = new Map([[1, new Map([['2026-10-27', { activeSeconds: 3600 * 6 }], ['2026-10-29', { activeSeconds: 600 }]])]]);

  const [row] = buildActiveTimeRows([member(1, 'Asha')], dates, attendance, panel, '2026-10-31', '12:00');
  assert.deepEqual(
    row.days.map((d) => [d.panelSeconds, d.shiftMinutes, d.status]),
    [
      [21600, 540, 'On time'],
      [0, 0, 'Leave'],
      [600, 0, 'Weekly off'],
    ],
  );
  assert.deepEqual(row.totals, { panelSeconds: 22200, shiftMinutes: 540 });
  assert.equal(row.shiftStart, '10:00', 'shift shown as HH:MM');
});

test('a day before joining or after leaving reads as no status, not as an absence', () => {
  const [row] = buildActiveTimeRows([member(1, 'Asha')], ['2026-10-27'], new Map(), new Map(), '2026-10-31', '12:00');
  assert.equal(row.days[0].status, null);
  assert.equal(row.days[0].shiftMinutes, 0);
});

test('today, still checked in: counted up to now', () => {
  assert.equal(
    shiftMinutesOf(day({ date: '2026-10-31', loginAt: '10:00', logoutAt: null, activeHours: 0 }), '2026-10-31', '12:30'),
    150,
  );
});

test('rows come back by name', () => {
  const rows = buildActiveTimeRows([member(2, 'Zoya'), member(1, 'Asha')], [], new Map(), new Map(), '2026-10-31', '12:00');
  assert.deepEqual(rows.map((r) => r.name), ['Asha', 'Zoya']);
});

// ── Who may see whom ──────────────────────────────────────────────────────

function serviceFor(tiers: string[]) {
  const asked: { rootId?: number | null } = {};
  const roster = [1, 2, 3].map((id) => ({
    id,
    employeeCode: `E${id}`,
    fullName: `Person ${id}`,
    designation: null,
    department: id === 3 ? 'Ops' : 'Sales',
    managerId: null,
    managerName: null,
    workMode: 'WFO',
    shiftStart: '10:00',
    shiftEnd: '19:00',
    weeklyOff: ['Sun'],
    dateOfJoining: '2026-01-01',
    dateOfLeaving: id === 2 ? '2026-09-30' : null,
  }));
  const service = new ReportsService(
    {} as never,
    {} as never,
    { getCurrentEmployee: async (id: number) => ({ id, tiers }) } as never,
    {
      findSchedulesFor: async () => new Map(),
      findRangeFor: async () => [],
      findActivitySlotsFor: async () => new Map(),
      findHolidaysBetween: async () => new Map(),
      findApprovedLeavesBetween: async () => [],
    } as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      findRoster: async (scope: { rootId: number | null }) => {
        asked.rootId = scope.rootId;
        return roster;
      },
    } as never,
  );
  return { service, asked };
}

const RANGE = { from: '2026-10-27', to: '2026-10-28' };

test('an admin is given the whole company; a manager only their reporting tree', async () => {
  const admin = serviceFor(['employee', 'admin']);
  await admin.service.getActiveTime(9, RANGE);
  assert.equal(admin.asked.rootId, null);

  const manager = serviceFor(['employee', 'manager']);
  await manager.service.getActiveTime(9, RANGE);
  assert.equal(manager.asked.rootId, 9);
});

test('an employee is refused', async () => {
  const { service } = serviceFor(['employee']);
  await assert.rejects(service.getActiveTime(9, RANGE), (e: { statusCode?: number }) => e.statusCode === 403);
});

test('someone who left before the range is not listed; ids outside the scope are dropped', async () => {
  const { service } = serviceFor(['employee', 'manager']);
  const all = await service.getActiveTime(9, RANGE);
  assert.deepEqual(all.people.map((p) => p.id), [1, 3]);

  const picked = await service.getActiveTime(9, { ...RANGE, employeeIds: [3, 999] });
  assert.deepEqual(picked.rows.map((r) => r.employeeId), [3]);
  assert.deepEqual(picked.people.map((p) => p.id), [1, 3], 'the picker still lists the whole scope');
});

test('department narrows the rows; too long a range is refused', async () => {
  const { service } = serviceFor(['employee', 'admin']);
  const sales = await service.getActiveTime(9, { ...RANGE, department: 'Sales' });
  assert.deepEqual(sales.rows.map((r) => r.employeeId), [1]);
  await assert.rejects(
    service.getActiveTime(9, { from: '2026-01-01', to: '2026-06-30' }),
    (e: { statusCode?: number }) => e.statusCode === 400,
  );
});
