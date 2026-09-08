/**
 * What an employee is paid, as at a date.
 *
 * `hrms_employee_compensation` is a HISTORY: one row per revision, keyed on
 * (employee_id, effective_from). A raise is a new row, never an edit, so the
 * figures that applied to any past month can always be recovered — which is
 * what payroll will need when it reprints an old payslip.
 *
 * Money is whole rupees in a BIGINT. No floats go anywhere near pay.
 */
export interface CompensationRecord {
  id: number;
  employeeId: number;
  effectiveFrom: string;
  /** Annual cost to company. */
  ctc: number;
  variablePay: number;
  bonus: number;
  esopUnits: number;
  /** Share of the grant vested, 0–100. */
  esopVestedPct: number;
  revisionNote: string | null;
  createdAt: string;
}
