import type { ReportColumn, ReportResult } from './reports.model';

/**
 * The six columns every report in the Reports centre starts with:
 *
 *   EMP Id · Emp Name · Manager's Name · Designation · Department · Head of Department
 *
 * Each report used to name its own identity columns (`code`, `empId`,
 * `employeeNo`, `employee`, `empName`, `name`, …) and some left the manager or
 * designation out. Rather than edit twenty-odd builders to agree, every builder
 * stamps its rows with `_employeeId`, and `withStandardColumns` replaces those
 * identity columns with these six, from one lookup. A new report gets them for
 * free.
 *
 * Pure: no database. The lookup rows come in, a finished report goes out.
 */

/** One employee as the identity lookup reads them — hrms_employees + manager's name. */
export interface IdentityRow {
  id: number;
  employee_code: string;
  full_name: string;
  designation: string | null;
  department: string | null;
  manager_id: number | null;
  manager_name: string | null;
}

export interface EmployeeIdentity {
  stdEmpId: string;
  stdEmpName: string;
  stdManager: string;
  stdDesignation: string;
  stdDepartment: string;
  stdHeadOfDepartment: string;
}

export const STANDARD_COLUMNS: ReportColumn[] = [
  { key: 'stdEmpId', label: 'EMP Id', width: '100px' },
  { key: 'stdEmpName', label: 'Emp Name', width: '180px' },
  { key: 'stdManager', label: "Manager's Name", width: '170px' },
  { key: 'stdDesignation', label: 'Designation', width: '160px' },
  { key: 'stdDepartment', label: 'Department', width: '140px' },
  { key: 'stdHeadOfDepartment', label: 'Head of Department', width: '170px' },
];

/**
 * The per-report identity columns the six replace. Dropped so nothing appears
 * twice. Kept on purpose: `beneficiaryName` (the bank's payee field in the Net
 * pay file) and `managerId`.
 */
const REPLACED_KEYS = new Set([
  'code',
  'empId',
  'employeeNo',
  'employee',
  'empName',
  'employeeName',
  'name',
  'manager',
  'managerName',
  'designation',
  'department',
]);

/**
 * The head of someone's department: walk up the reporting line — manager, their
 * manager, and so on — to the person who has no manager. That person heads the
 * line. Someone with no manager heads their own.
 *
 * Memoised across calls through `cache`, so a whole company is O(n). A loop in
 * the data (A reports to B, B to A) stops at the first person seen twice
 * rather than spinning; a manager id that points at nobody stops where the
 * chain breaks.
 */
export function headOfLine(
  id: number,
  managerOf: ReadonlyMap<number, number | null>,
  cache: Map<number, number> = new Map(),
): number {
  const path: number[] = [];
  const seen = new Set<number>();
  let current = id;

  for (;;) {
    const known = cache.get(current);
    if (known !== undefined) {
      for (const p of path) cache.set(p, known);
      return known;
    }
    path.push(current);
    seen.add(current);
    const next = managerOf.get(current);
    if (next === null || next === undefined || !managerOf.has(next) || seen.has(next)) {
      for (const p of path) cache.set(p, current);
      return current;
    }
    current = next;
  }
}

/** Everyone's six standard values, keyed by hrms_employees.id. */
export function buildIdentities(rows: IdentityRow[]): Map<number, EmployeeIdentity> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const managerOf = new Map(rows.map((r) => [r.id, r.manager_id]));
  const cache = new Map<number, number>();
  const result = new Map<number, EmployeeIdentity>();

  for (const r of rows) {
    const head = byId.get(headOfLine(r.id, managerOf, cache));
    result.set(r.id, {
      stdEmpId: r.employee_code,
      stdEmpName: r.full_name,
      stdManager: r.manager_name ?? '—',
      stdDesignation: r.designation ?? '—',
      stdDepartment: r.department ?? '—',
      stdHeadOfDepartment: head?.full_name ?? '—',
    });
  }
  return result;
}

/** A row's first filled identity cell — how a "Total" row keeps its label. */
const labelOf = (row: Record<string, unknown>): string => {
  for (const key of REPLACED_KEYS) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value);
  }
  return '';
};

/**
 * Puts the six standard columns first and drops the report's own copies.
 *
 * Rows stamped with `_employeeId` get that person's values. Rows without one —
 * a "Total" line, a group heading — keep their label in the EMP Id column and
 * leave the rest blank. The footer totals are treated the same way.
 */
export function withStandardColumns(
  report: ReportResult,
  identities: ReadonlyMap<number, EmployeeIdentity>,
): ReportResult {
  const columns = [
    ...STANDARD_COLUMNS,
    ...report.columns.filter((c) => !REPLACED_KEYS.has(c.key)),
  ];

  const rows = report.rows.map((row) => {
    const { _employeeId, ...rest } = row;
    const identity = typeof _employeeId === 'number' ? identities.get(_employeeId) : undefined;
    const standard: Record<string, string> = identity
      ? { ...identity }
      : {
          stdEmpId: labelOf(row),
          stdEmpName: '',
          stdManager: '',
          stdDesignation: '',
          stdDepartment: '',
          stdHeadOfDepartment: '',
        };
    return { ...standard, ...rest };
  });

  let totals = report.totals;
  if (totals) {
    const label = labelOf(totals);
    totals = { ...totals, ...(label ? { stdEmpId: label } : {}) };
  }

  return { ...report, columns, rows, totals };
}
