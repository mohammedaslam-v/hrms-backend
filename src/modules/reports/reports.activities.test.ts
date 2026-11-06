import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReportsService } from './reports.service';
import { buildActivityRows } from './reports.activities';
import type { WorkActivity } from '../work-activity/work-activity.model';

// Attendance & activity → Activities.

const activity = (id: number, employeeId: number, date: string, startTime: string, endTime: string, note = ''): WorkActivity => ({
  id,
  employeeId,
  date,
  type: 'phone_call',
  startTime,
  endTime,
  note: note || null,
  createdAt: '',
});

test('a row per person per day with activities or panel time, newest first', () => {
  const rows = buildActivityRows(
    [
      { id: 1, employeeCode: '1', fullName: 'Sabreena', department: 'Sales' },
      { id: 2, employeeCode: '2', fullName: 'Arun', department: 'Sales' },
    ],
    ['2026-11-01', '2026-11-02', '2026-11-03'],
    new Map([[1, [activity(2, 1, '2026-11-01', '11:00', '11:45', 'Team meeting'), activity(1, 1, '2026-11-01', '10:00', '10:22')]]]),
    new Map([
      [1, new Map([['2026-11-01', { activeSeconds: 15_600 }]])],
      [2, new Map([['2026-11-02', { activeSeconds: 3_600 }], ['2026-11-03', { activeSeconds: 30 }]])],
    ]),
    new Map([[2, new Map([['2026-11-02', { status: 'Weekly off' as const }]])]]),
  );

  assert.deepEqual(
    rows.map((r) => [r.date, r.name, r.panelSeconds, r.activityMinutes, r.dayOff, r.activities.map((a) => a.startTime)]),
    [
      // 3 Nov: Arun had 30 seconds only — no row.
      ['2026-11-02', 'Arun', 3_600, 0, 'Weekly off', []],
      ['2026-11-01', 'Sabreena', 15_600, 67, null, ['10:00', '11:00']],
    ],
  );
});

function serviceFor(viewer: { id: number; tiers: string[]; workEmail?: string }, tree: unknown[], everyone: unknown[] = []) {
  const calls: unknown[] = [];
  const service = new ReportsService(
    {} as never,
    {} as never,
    { getCurrentEmployee: async () => viewer } as never,
    // Never reached: RANGE picks nobody, and `people` is the scope either way.
    {} as never,
    undefined,
    { findRangeForMany: async () => new Map() } as never,
    undefined,
    undefined,
    undefined,
    {
      findRoster: async (scope: { rootId: number | null }) => {
        calls.push(scope);
        return scope.rootId === null ? everyone : tree;
      },
    } as never,
  );
  return { service, calls };
}

const member = (id: number, managerId: number, department: string) => ({
  id,
  employeeCode: String(id),
  fullName: `P${id}`,
  department,
  managerId,
  dateOfJoining: '2026-01-01',
  dateOfLeaving: null,
});

/** `people` lists the whole scope whatever is picked; picking nobody skips loading days. */
const RANGE = { from: '2026-11-01', to: '2026-11-02', employeeIds: [999_999] };

test('a manager sees direct reports, and the next level only in Sales or Operations', async () => {
  const { service } = serviceFor({ id: 10, tiers: ['manager'] }, [
    member(11, 10, 'Tech'),
    member(12, 10, 'Sales'),
    member(21, 11, 'Tech'), // level 2, Tech — hidden
    member(22, 12, 'Sales'), // level 2, Sales — shown
    member(23, 12, 'Operations'), // level 2, Operations — shown
  ]);
  const view = await service.getActivities(10, RANGE);
  assert.deepEqual(view.people.map((p) => p.id).sort(), [11, 12, 22, 23]);
});

test('the senior approver also sees everyone in Sales and Operations', async () => {
  const { service } = serviceFor(
    { id: 5, tiers: ['manager'] },
    [member(6, 5, 'Sales')],
    [member(6, 5, 'Sales'), member(40, 30, 'Sales'), member(41, 30, 'Tech')],
  );
  const view = await service.getActivities(5, RANGE);
  assert.deepEqual(view.people.map((p) => p.id).sort(), [40, 6]);
});

test('someone who is neither manager nor admin is refused', async () => {
  const { service } = serviceFor({ id: 1, tiers: ['employee'] }, []);
  await assert.rejects(service.getActivities(1, RANGE), /managers and admins/);
});
