import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReportsService } from './reports.service';
import type { StoredLeaveRequest } from '../leave/leave.repository.interface';

// The Leave report in the Reports centre: who was on leave in the chosen dates.

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

const request = (
  employeeId: number,
  fromDate: string,
  toDate: string,
  extra: Partial<StoredLeaveRequest> = {},
): StoredLeaveRequest =>
  ({
    id: employeeId * 100 + Number(fromDate.slice(8)),
    ref: `LV-${employeeId}`,
    employeeId,
    leaveType: 'Earned',
    fromDate,
    toDate,
    days: 1,
    unpaidDays: 0,
    status: 'Approved',
    isHalfDay: false,
    ...extra,
  }) as StoredLeaveRequest;

function serviceWith(employees: unknown[], requests: StoredLeaveRequest[]) {
  return new ReportsService(
    { findActiveEmployees: async () => employees } as never,
    {} as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      findLeaveYearForDate: async () => ({
        leaveYear: 2026,
        startDate: '2026-04-01',
        endDate: '2027-03-31',
        leavePerMonth: 2,
        annualEntitlement: 24,
        carryCap: 30,
      }),
      findHolidays: async () => [],
      findRequestsForEmployees: async () => requests,
    } as never,
  );
}

const SEVEN_TO_EIGHT = { type: 'leave', period: 'range', from: '2026-10-07', to: '2026-10-08' } as never;

test('lists only people with leave in the period, counting only days inside it', async () => {
  const service = serviceWith(
    [
      employee(1, '86', 'Yash Gupta'),
      employee(2, '10', 'Rhea Diwan'),
      employee(3, '11', 'Nobody Off'),
      employee(4, 'TEST-ADM', 'Test Admin'),
    ],
    [
      // Twelve days of leave, two of which fall on 7–8 Oct.
      request(1, '2026-10-01', '2026-10-12', { days: 10 }),
      request(2, '2026-10-08', '2026-10-08', { leaveType: 'Unpaid', unpaidDays: 1 }),
      request(3, '2026-11-02', '2026-11-02'),
      request(4, '2026-10-07', '2026-10-07'),
    ],
  );

  const report = await service.generateReport(SEVEN_TO_EIGHT, 0);
  assert.deepEqual(
    report.rows.map((r) => [r.employee, r.dates, r.paid, r.lop]),
    [
      ['Rhea Diwan', '8 Oct · LOP', 0, 1],
      ['Yash Gupta', '7–8 Oct', 2, 0],
    ],
  );
  assert.deepEqual(report.totals, { employee: 'Total', paid: 2, lop: 1, pending: 0 });
  assert.ok(!report.columns.some((c) => c.key === 'lastLeave'));
});

test('pending, half-day and part-unpaid requests are split out', async () => {
  const service = serviceWith(
    [employee(1, '1', 'A', '0')],
    [
      request(1, '2026-10-07', '2026-10-07', { isHalfDay: true, days: 0.5 }),
      request(1, '2026-10-08', '2026-10-08', { status: 'Pending' }),
      request(1, '2026-10-06', '2026-10-07', { days: 2, unpaidDays: 1 }),
      request(1, '2026-10-08', '2026-10-08', { status: 'Rejected' }),
    ],
  );

  const [row] = (await service.generateReport(SEVEN_TO_EIGHT, 0)).rows;
  assert.equal(row.department, '—');
  assert.equal(row.paid, 1); // half day + the earned half of 7 Oct
  assert.equal(row.lop, 0.5);
  assert.equal(row.pending, 1);
  assert.equal(row.dates, '7 Oct · part LOP, 7 Oct (half), 8 Oct · awaiting');
});
