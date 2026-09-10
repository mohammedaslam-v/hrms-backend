import { GoalView } from './goals.model';

export interface IGoalsService {
  /**
   * This employee's goals for the current financial year, with progress and
   * status already resolved.
   *
   * Read only. Creating and editing goals belongs to the Goals page, so that the
   * rules for writing them live in one place rather than being reimplemented by
   * every screen that shows a list.
   */
  getForEmployee(employeeId: number): Promise<GoalView[]>;
}
