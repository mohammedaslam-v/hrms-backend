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

  /**
   * The same, for many people at once, keyed by employee.
   *
   * Returns the whole history rather than a pre-picked "current" row, so which
   * revision applies is still decided by the tested domain function instead of
   * being reimplemented as a MAX() in SQL. An employee has a handful of
   * revisions in a career, so even the whole company is a small result.
   */
  findHistoryForMany(employeeIds: number[]): Promise<Map<number, CompensationRecord[]>>;
}
