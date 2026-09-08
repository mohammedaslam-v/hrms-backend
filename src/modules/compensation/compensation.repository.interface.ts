import { CompensationRecord } from './compensation.model';

export interface ICompensationRepository {
  /**
   * Every revision for this employee, most recent first.
   *
   * The whole history rather than a single row: an employee has a handful of
   * revisions in a career, so the cost is nil, and it means the rule for which
   * one applies lives in a tested pure function instead of in a WHERE clause.
   * The Salary page will want the same list.
   */
  findHistory(employeeId: number): Promise<CompensationRecord[]>;
}
