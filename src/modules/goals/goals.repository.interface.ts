import { GoalRecord } from './goals.domain';

export interface IGoalsRepository {
  /**
   * Every goal this employee holds for the given financial year, with its
   * milestones already attached.
   *
   * One round trip, not one per goal: a person can hold a dozen goals and each
   * carries a handful of milestones, and fetching those separately is the
   * classic N+1 that only shows up once real data arrives.
   */
  findForEmployee(employeeId: number, fy: string): Promise<GoalRecord[]>;
}
