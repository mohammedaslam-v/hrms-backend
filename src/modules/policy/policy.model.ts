/**
 * Company policy numbers, held in `hrms_fy_config` — one row per financial year.
 *
 * These are values HR and Finance change, not constants a developer chose. They
 * live in the database so a change is a row edit rather than a deployment, and
 * so a past year keeps the numbers that were actually applied to it.
 *
 * Note the two cycles this system runs on, which are NOT the same:
 *   · the FINANCIAL year (April–March) — this table. Payroll, tax, attendance.
 *   · the LEAVE year (January–December) — `hrms_leave_years`. Accrual only.
 */
export interface FinancialYearConfig {
  /** e.g. '2026-27' */
  fy: string;
  /** Assessment year, e.g. '2027-28' */
  ay: string;
  fyStart: string;
  fyEnd: string;

  // ---- attendance --------------------------------------------------------
  /**
   * Minutes after `shift_start` before a login counts as Late.
   *
   * The single definition of lateness. It decides the stored status, the late
   * logins report and the punctuality percentage — three readings that must
   * never be able to disagree.
   */
  lateGraceMinutes: number;

  // ---- goals -------------------------------------------------------------
  /**
   * How many points behind elapsed time a goal may fall before it reads as
   * At risk. Progress is compared against time elapsed, not a fixed threshold,
   * so 30% halfway through a quarter is at risk and the same 30% in week one
   * is not.
   */
  goalRiskTolerancePct: number;

  // ---- salary structure and tax -----------------------------------------
  // Carried here so the Salary page reads the same row rather than opening a
  // second source of truth for the same year.
  basicPct: number;
  hraPctOfBasic: number;
  gratuityPct: number;
  pfCeiling: number;
  pfRate: number;
  epsRate: number;
  epsCap: number;
  stdDeduction: number;
  rebateCap: number;
  rebateMax: number;
  cessRate: number;
}
