import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProductivityService } from './productivity.service';

// Sales, day shift 10–19, usual off Sunday. 16 Nov 2026 is a Monday.
const employee = (id: number) => ({
  id,
  adminId: id + 100,
  department: 'Sales',
  shiftStart: '10:00',
  shiftEnd: '19:00',
  weeklyOff: ['Sun'],
  dateOfJoining: '2026-01-01',
  dateOfLeaving: null,
});

function harness(opts: {
  now: { date: string; time: string };
  panelSeconds: Record<number, number>;
  activityMinutes?: Record<number, number>;
  unpaidIfEarned?: Record<number, boolean>;
  records?: unknown[];
  decided?: string[];
}) {
  const writes: string[] = [];
  const claimed = new Set(opts.decided ?? []);
  const service = new ProductivityService(
    {
      findRuledEmployees: async () => [employee(1), employee(2), employee(3)],
      findDecided: async () => new Set(opts.decided ?? []),
      claim: async (d: { employeeId: number; date: string; outcome: string }) => {
        const key = `${d.employeeId}|${d.date}`;
        if (claimed.has(key)) return false;
        claimed.add(key);
        writes.push(`claim ${key} ${d.outcome}`);
        return true;
      },
      release: async () => undefined,
      findPanelSecondsBetween: async () => new Map(),
    } as never,
    {
      now: async () => opts.now,
      findRangeFor: async () => opts.records ?? [],
      findHolidaysBetween: async () => new Map(),
      saveManualDay: async (r: { employeeId: number; date: string; status: string; loginAt: string | null }) => {
        writes.push(`day ${r.employeeId}|${r.date} ${r.status} ${r.loginAt ?? '-'}`);
        return null;
      },
      checkOut: async (r: { id: number; logoutAt: string }) => {
        writes.push(`checkout ${r.id} ${r.logoutAt}`);
        return null;
      },
      recordAudit: async () => undefined,
    } as never,
    { findRequestsForEmployees: async () => [] } as never,
    {
      preview: async (id: number) => ({ days: 1, unpaidDays: opts.unpaidIfEarned?.[id] ? 1 : 0 }),
      setDayLeave: async (_a: number, id: number, date: string, choice: { leaveType: string }) => {
        writes.push(`leave ${id}|${date} ${choice.leaveType}`);
        return null;
      },
    } as never,
    {
      findRangeForMany: async () =>
        new Map(
          Object.entries(opts.activityMinutes ?? {}).map(([id, m]) => [
            Number(id),
            [{ date: '2026-11-16', startTime: '10:00', endTime: `${String(10 + Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }],
          ]),
        ),
    } as never,
    {
      adminPanelForReport: async () =>
        new Map(Object.entries(opts.panelSeconds).map(([id, s]) => [Number(id), new Map([['2026-11-16', { activeSeconds: s }]])])),
    } as never,
  );
  return { service, writes };
}

test('before shift end + 4 hours nothing is decided', async () => {
  const { service, writes } = harness({ now: { date: '2026-11-16', time: '22:59:00' }, panelSeconds: {} });
  const s = await service.settleDue();
  assert.equal(s.decided, 0);
  assert.deepEqual(writes, []);
});

test('met without a check-in is marked present; short days become EL or LOP by balance', async () => {
  const { service, writes } = harness({
    now: { date: '2026-11-16', time: '23:00:00' },
    panelSeconds: { 1: 6 * 3600, 2: 4 * 3600, 3: 4 * 3600 },
    activityMinutes: { 1: 150, 2: 180, 3: 180 }, // 8h 30m, 7h, 7h
    unpaidIfEarned: { 3: true },
  });
  const s = await service.settleDue();
  assert.deepEqual(s, { checked: 3, decided: 3, met: 1, earned: 1, unpaid: 1, failed: 0 });
  assert.deepEqual(writes, [
    'claim 1|2026-11-16 met',
    'day 1|2026-11-16 On time 10:00',
    'claim 2|2026-11-16 earned',
    'leave 2|2026-11-16 Earned',
    'day 2|2026-11-16 Leave -',
    'claim 3|2026-11-16 unpaid',
    'leave 3|2026-11-16 Unpaid',
    'day 3|2026-11-16 Leave -',
  ]);
});

test('a check-in left open on a met day is closed at the shift end, a full punch is left alone', async () => {
  const { service, writes } = harness({
    now: { date: '2026-11-16', time: '23:30:00' },
    panelSeconds: { 1: 9 * 3600, 2: 9 * 3600, 3: 9 * 3600 },
    records: [
      { id: 71, employeeId: 1, date: '2026-11-16', source: 'app', status: 'On time', loginAt: '10:02', logoutAt: null },
      { id: 72, employeeId: 2, date: '2026-11-16', source: 'app', status: 'On time', loginAt: '10:00', logoutAt: '19:05' },
    ],
  });
  await service.settleDue();
  assert.deepEqual(
    writes.filter((w) => !w.startsWith('claim')),
    ['checkout 71 19:00', 'day 3|2026-11-16 On time 10:00'],
  );
});

test('a day already decided is never decided again', async () => {
  const { service, writes } = harness({
    now: { date: '2026-11-17', time: '09:00:00' },
    panelSeconds: { 1: 0, 2: 0, 3: 0 },
    decided: ['1|2026-11-16', '2|2026-11-16', '3|2026-11-16'],
  });
  await service.settleDue();
  assert.ok(!writes.some((w) => w.includes('2026-11-16')));
});
