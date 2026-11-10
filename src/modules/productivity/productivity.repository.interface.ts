import { ProductivityDecision, RuledEmployee } from './productivity.model';

export interface IProductivityRepository {
  /** Everyone currently in a department the rule covers, leavers included (filtered by date later). */
  findRuledEmployees(departments: string[]): Promise<RuledEmployee[]>;

  /** `employeeId|date` of every day already decided in the range. */
  findDecided(employeeIds: number[], from: string, to: string): Promise<Set<string>>;

  /**
   * Records a decision. False when the day was already decided — another
   * instance got there first — and the caller must then do nothing.
   */
  claim(decision: ProductivityDecision): Promise<boolean>;

  /** Undoes a claim whose writes failed, so the next run tries again. */
  release(employeeId: number, date: string): Promise<void>;

  /**
   * Panel seconds per admin between two India times ('YYYY-MM-DD HH:MM'),
   * from the per-hour table. For night shifts, which cross midnight.
   */
  findPanelSecondsBetween(adminIds: number[], from: string, to: string): Promise<Map<number, number>>;
}
