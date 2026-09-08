import { FinancialYearConfig } from './policy.model';

export interface IPolicyRepository {
  /**
   * The financial year containing `date`, or null when none is configured.
   *
   * Looked up by date rather than by name so a caller never has to work out
   * which FY a day belongs to — the April boundary is the table's problem.
   */
  findFinancialYearForDate(date: string): Promise<FinancialYearConfig | null>;
}
