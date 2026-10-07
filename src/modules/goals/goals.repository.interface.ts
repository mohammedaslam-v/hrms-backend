import { GoalApprovalStatus, GoalRecord } from './goals.domain';
import { CreateGoalDto, UpdateGoalDto } from './goals.model';

export interface IGoalsRepository {
  findForEmployee(employeeId: number, fy: string): Promise<GoalRecord[]>;
  findForEmployees(employeeIds: number[], fy: string): Promise<Map<number, GoalRecord[]>>;
  findById(id: number): Promise<GoalRecord | null>;
  create(
    dto: CreateGoalDto,
    fy: string,
    setBy: number | null,
    setOn: string,
    approvalStatus?: GoalApprovalStatus,
    approvedBy?: number | null,
    approvedAt?: string | null,
  ): Promise<GoalRecord>;
  update(id: number, dto: UpdateGoalDto, resetApproval?: boolean): Promise<GoalRecord>;
  approve(id: number, approverId: number): Promise<void>;
  reject(id: number, approverId: number, reason?: string | null): Promise<void>;
  updateMetric(id: number, currentValue: number): Promise<void>;
  toggleMilestone(milestoneId: number, isDone: boolean, doneBy: number): Promise<void>;
  delete(id: number): Promise<void>;
}
