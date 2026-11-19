import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReportsService } from './reports.service';
import type { AttendanceRecord, WorkSchedule } from '../attendance/attendance.model';
import type { StoredLeaveRequest } from '../leave/leave.repository.interface';
import { ApiError } from '../../utils/api-error';

const employee = (id: number, code: string, name: string, department = 'Sales') => ({
  id,
  employee_code: code,
  full_name: name,
  department,
  weekly_off: 'Sun',
  opening_leave: 0,
  date_of_joining: '2026-04-01',
  date_of_leaving: null,
});

function createMockLopService(options: {
  employees?: ReturnType<typeof employee>[];
  punches?: Partial<AttendanceRecord>[];
  schedules?: Record<number, Partial<WorkSchedule>>;
  approvedLeaves?: StoredLeaveRequest[];
  viewerTiers?: string[];
}) {
  const employees = options.employees ?? [
    employee(1, 'BAM-001', 'Alice Sharma'),
    employee(2, 'BAM-002', 'Bob Verma'),
  ];
  const punches = (options.punches ?? []).map((p, idx) => ({
    id: idx + 1,
    employeeId: p.employeeId ?? 1,
    date: p.date ?? '2026-10-05',
    status: p.status ?? 'On time',
    loginAt: p.loginAt ?? '10:00:00',
    logoutAt: p.logoutAt ?? '19:00:00',
    activeHours: p.activeHours ?? 9.0,
    lateByMinutes: p.lateByMinutes ?? 0,
    leaveType: p.leaveType ?? null,
    holidayName: null,
    source: p.source ?? 'app',
    editedBy: p.editedBy ?? null,
    editNote: p.editNote ?? null,
  })) as AttendanceRecord[];

  const schedules = new Map<number, WorkSchedule>();
  for (const emp of employees) {
    const custom = options.schedules?.[emp.id];
    schedules.set(emp.id, {
      shiftStart: custom?.shiftStart ?? '10:00',
      shiftEnd: custom?.shiftEnd ?? '19:00',
      weeklyOff: custom?.weeklyOff ?? ['Sun'],
      dateOfLeaving: null,
      portalRole: null,
      workMode: 'Office',
      homeLat: null,
      homeLng: null,
      homeEnabled: false,
      secondLat: null,
      secondLng: null,
    });
  }

  const authService = {
    getCurrentEmployee: async (id: number) => ({
      id,
      tiers: options.viewerTiers ?? ['admin'],
    }),
  } as never;

  const attendanceRepository = {
    findSchedulesFor: async () => schedules,
    findRangeFor: async () => punches,
    findActivitySlotsFor: async () => new Map(),
    findHolidaysBetween: async () => new Map(),
    findApprovedLeavesBetween: async () => [],
  } as never;

  const leaveRepository = {
    findRequestsForEmployees: async () => options.approvedLeaves ?? [],
  } as never;

  return new ReportsService(
    { findActiveEmployees: async () => employees } as never,
    {} as never,
    authService,
    attendanceRepository,
    undefined,
    undefined,
    undefined,
    leaveRepository,
  );
}

test('LOP report access control: non-admins are refused with 403 Forbidden', async () => {
  const service = createMockLopService({ viewerTiers: ['manager'] });
  await assert.rejects(
    () => service.generateReport({ type: 'lop', period: 'range', from: '2026-10-01', to: '2026-10-05' }, 99),
    (err: ApiError) => {
      assert.equal(err.statusCode, 403);
      assert.match(err.message, /administrators/i);
      return true;
    },
  );
});

test('LOP report catalog: hidden from non-admins and visible to admins', async () => {
  const adminService = createMockLopService({ viewerTiers: ['admin'] });
  const adminCatalog = await adminService.getCatalog(1);
  assert.ok(adminCatalog.some((item) => item.type === 'lop'));

  const managerService = createMockLopService({ viewerTiers: ['manager'] });
  const managerCatalog = await managerService.getCatalog(2);
  assert.ok(!managerCatalog.some((item) => item.type === 'lop'));
});

test('LOP report detects Half-Day LOP for late login >= 25 min without leave balance', async () => {
  const service = createMockLopService({
    employees: [employee(1, 'BAM-001', 'Late Worker')],
    punches: [
      {
        employeeId: 1,
        date: '2026-10-05', // Monday
        status: 'Half day',
        loginAt: '10:35:00',
        logoutAt: '19:00:00',
        lateByMinutes: 35,
        leaveType: 'Unpaid',
        editNote: 'Late check-in by 35m (no leave balance) -> 0.5 Half-day Unpaid (LOP)',
      },
    ],
  });

  const report = await service.generateReport(
    { type: 'lop', period: 'range', from: '2026-10-05', to: '2026-10-05' },
    1,
  );

  assert.equal(report.rows.length, 1);
  const row = report.rows[0];
  assert.equal(row.lopCategory, 'Half-Day LOP');
  assert.equal(row.lopDays, 0.5);
  assert.equal(row.checkIn, '10:35');
  assert.equal(row.lateBy, 35);
  assert.match(row.reason, /Late check-in by 35m/);
  assert.equal(report.totals?.lopDays, 0.5);
});

test('LOP report detects Full-Day LOP for auto-closed missed check-out', async () => {
  const service = createMockLopService({
    employees: [employee(1, 'BAM-001', 'Forgetful Worker')],
    punches: [
      {
        employeeId: 1,
        date: '2026-10-05',
        status: 'Leave',
        loginAt: '10:00:00',
        logoutAt: null,
        activeHours: 0,
        lateByMinutes: 0,
        leaveType: 'Unpaid',
        editNote: 'Auto-closed: Missed check-out (LOP)',
      },
    ],
  });

  const report = await service.generateReport(
    { type: 'lop', period: 'range', from: '2026-10-05', to: '2026-10-05' },
    1,
  );

  assert.equal(report.rows.length, 1);
  const row = report.rows[0];
  assert.equal(row.lopCategory, 'Full-Day LOP');
  assert.equal(row.lopDays, 1.0);
  assert.equal(row.checkIn, '10:00');
  assert.equal(row.checkOut, '—');
  assert.equal(row.reason, 'Auto-closed: Missed check-out (LOP)');
  assert.equal(report.totals?.lopDays, 1.0);
});

test('LOP report detects Full-Day LOP for no login activity on past working days', async () => {
  const service = createMockLopService({
    employees: [employee(1, 'BAM-001', 'Absent Worker')],
    punches: [], // No punches at all
  });

  const report = await service.generateReport(
    { type: 'lop', period: 'range', from: '2026-10-05', to: '2026-10-05' }, // 2026-10-05 was Monday
    1,
  );

  assert.equal(report.rows.length, 1);
  const row = report.rows[0];
  assert.equal(row.lopCategory, 'Full-Day LOP');
  assert.equal(row.lopDays, 1.0);
  assert.equal(row.checkIn, '—');
  assert.equal(row.reason, 'No login activity (Absent)');
});

test('LOP report filters separately by Half-Day LOP and Full-Day LOP', async () => {
  const service = createMockLopService({
    employees: [
      employee(1, 'BAM-001', 'Late Worker'),
      employee(2, 'BAM-002', 'Absent Worker'),
    ],
    punches: [
      {
        employeeId: 1,
        date: '2026-10-05',
        status: 'Half day',
        loginAt: '10:30:00',
        logoutAt: '19:00:00',
        lateByMinutes: 30,
        leaveType: 'Unpaid',
      },
      // Employee 2 has no punch -> No login activity
    ],
  });

  // All LOP
  const allReport = await service.generateReport(
    { type: 'lop', period: 'range', from: '2026-10-05', to: '2026-10-05', lopCategory: 'all' },
    1,
  );
  assert.equal(allReport.rows.length, 2);
  assert.equal(allReport.totals?.lopDays, 1.5);

  // Half-Day LOP only
  const halfReport = await service.generateReport(
    { type: 'lop', period: 'range', from: '2026-10-05', to: '2026-10-05', lopCategory: 'half_day' },
    1,
  );
  assert.equal(halfReport.rows.length, 1);
  assert.equal(halfReport.rows[0].employee, 'Late Worker');
  assert.equal(halfReport.rows[0].lopCategory, 'Half-Day LOP');
  assert.equal(halfReport.totals?.lopDays, 0.5);

  // Full-Day LOP only
  const fullReport = await service.generateReport(
    { type: 'lop', period: 'range', from: '2026-10-05', to: '2026-10-05', lopCategory: 'full_day' },
    1,
  );
  assert.equal(fullReport.rows.length, 1);
  assert.equal(fullReport.rows[0].employee, 'Absent Worker');
  assert.equal(fullReport.rows[0].lopCategory, 'Full-Day LOP');
  assert.equal(fullReport.totals?.lopDays, 1.0);
});
