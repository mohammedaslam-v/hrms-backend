import type { SalaryComponents } from '../salary/salary.domain';

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
  /** Monthly components HR set by hand; null means use the formula. */
  components?: SalaryComponents | null;
  /**
   * A dummy figure loaded so every card has something to edit, not real pay.
   * Payouts refuse to run on it.
   */
  isPlaceholder?: boolean;
}

/**
 * The sensitive part of a revision — everything that is encrypted into
 * `payload_enc`. The rest of the row (who, which date, when written) stays
 * readable so a person's history can still be found and ordered.
 */
export type CompensationFigures = Pick<
  CompensationRecord,
  'ctc' | 'variablePay' | 'bonus' | 'esopUnits' | 'esopVestedPct' | 'revisionNote'
> & { components: SalaryComponents | null };
