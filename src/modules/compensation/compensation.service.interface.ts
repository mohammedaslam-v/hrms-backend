import { CompensationRecord } from './compensation.model';

export interface ICompensationService {
  /**
   * What this employee is paid today, or null when nothing is on record.
   *
   * Null is a real answer rather than an error — most records have not been
   * loaded yet, and a card that says so is better than a request that fails.
   */
  getCurrent(employeeId: number): Promise<CompensationRecord | null>;

  /**
   * What each of these people is paid today, keyed by employee. Absent from the
   * map when nothing has taken effect for them yet.
   */
  getCurrentForMany(employeeIds: number[]): Promise<Map<number, CompensationRecord>>;
}
