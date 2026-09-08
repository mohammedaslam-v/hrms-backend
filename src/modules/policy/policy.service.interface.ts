import { FinancialYearConfig } from './policy.model';

export interface IPolicyService {
  /**
   * Policy in force on `date`. Throws 503 when the year is not configured —
   * the same shape of failure the leave service gives for a missing leave year,
   * because both mean "someone has to add a row", not "the request was wrong".
   */
  getForDate(date: string): Promise<FinancialYearConfig>;

  /** Policy in force today. */
  getCurrent(): Promise<FinancialYearConfig>;
}
