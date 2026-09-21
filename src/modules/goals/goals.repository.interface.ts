import { GoalRecord } from './goals.domain';
import { CreateGoalDto } from './goals.model';

export interface IGoalsRepository {
  findForEmployee(employeeId: number, fy: string): Promise<GoalRecord[]>;
  findForEmployees(employeeIds: number[], fy: string): Promise<Map<number, GoalRecord[]>>;
  findById(id: number): Promise<GoalRecord | null>;
  create(dto: CreateGoalDto, fy: string, setBy: number | null, setOn: string): Promise<GoalRecord>;
  updateMetric(id: number, currentValue: number): Promise<void>;
  toggleMilestone(milestoneId: number, isDone: boolean, doneBy: number): Promise<void>;
  delete(id: number): Promise<void>;
}
