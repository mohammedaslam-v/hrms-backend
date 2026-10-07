import { GoalView, MyGoalsSummaryView, TeamGoalsSummaryView, CreateGoalDto, UpdateGoalDto } from './goals.model';

export interface TeamGoalsFilter {
  period?: string;
  status?: string;
  employeeId?: number;
}

export interface IGoalsService {
  /**
   * This employee's goals for the current financial year, with progress and
   * status already resolved.
   */
  getForEmployee(employeeId: number): Promise<GoalView[]>;

  /**
   * Employee's own goals with calculated summary stats for My Goals tab.
   */
  getMyGoals(employeeId: number): Promise<MyGoalsSummaryView>;

  /**
   * Team goals grouped by member with team-level summary stats for Team Goals tab.
   */
  getTeamGoals(viewerId: number, filters?: TeamGoalsFilter): Promise<TeamGoalsSummaryView>;

  /**
   * Create a new goal for an employee (requires manager or admin).
   */
  createGoal(viewerId: number, dto: CreateGoalDto): Promise<GoalView>;

  /**
   * Update full goal definition (title, type, period, target, milestones, notes).
   */
  updateGoal(viewerId: number, goalId: number, dto: UpdateGoalDto): Promise<GoalView>;

  /**
   * Approve a pending goal (manager in reporting tree or admin).
   */
  approveGoal(viewerId: number, goalId: number): Promise<GoalView>;

  /**
   * Reject a pending goal with an optional reason (manager in reporting tree or admin).
   */
  rejectGoal(viewerId: number, goalId: number, reason?: string | null): Promise<GoalView>;

  /**
   * Update current value of a metric goal (employee themselves, manager or admin).
   */
  updateMetric(viewerId: number, goalId: number, value: number): Promise<GoalView>;

  /**
   * Check or uncheck a milestone (employee themselves, manager or admin).
   */
  toggleMilestone(viewerId: number, goalId: number, milestoneId: number, isDone: boolean): Promise<GoalView>;

  /**
   * Delete a goal (manager in reporting tree or admin).
   */
  deleteGoal(viewerId: number, goalId: number): Promise<void>;
}
