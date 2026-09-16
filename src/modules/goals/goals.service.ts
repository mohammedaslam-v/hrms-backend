import { IPolicyService } from '../policy/policy.service.interface';
import { IClock } from '../../shared/clock';
import { IAuthService } from '../auth/auth.service.interface';
import { IAccessService } from '../access/access.service.interface';
import { canRecordAbout } from '../access/access.domain';
import { IOrgRepository } from '../org/org.repository.interface';
import { ApiError } from '../../utils/api-error';
import { GoalRecord, goalProgress, goalStatus, periodWindow } from './goals.domain';
import {
  CreateGoalDto,
  GoalView,
  MemberGoalsGroup,
  MyGoalsSummaryView,
  TeamGoalsSummaryView,
} from './goals.model';
import { IGoalsRepository } from './goals.repository.interface';
import { IGoalsService, TeamGoalsFilter } from './goals.service.interface';

/**
 * Goals service.
 *
 * Handles both individual employee goal tracking and team-level management,
 * deriving progress and status dynamically according to financial year policy.
 */
export class GoalsService implements IGoalsService {
  constructor(
    private readonly goalsRepository: IGoalsRepository,
    private readonly policyService: IPolicyService,
    private readonly clock: IClock,
    private readonly authService: IAuthService,
    private readonly accessService: IAccessService,
    private readonly orgRepository: IOrgRepository,
  ) {}

  async getForEmployee(employeeId: number): Promise<GoalView[]> {
    const today = await this.clock.today();
    const policy = await this.policyService.getForDate(today);
    const goals = await this.goalsRepository.findForEmployee(employeeId, policy.fy);

    return goals.map((goal) =>
      this.toView(goal, policy.fyStart, today, policy.goalRiskTolerancePct),
    );
  }

  async getMyGoals(employeeId: number): Promise<MyGoalsSummaryView> {
    const goals = await this.getForEmployee(employeeId);

    const goalsThisYear = goals.length;
    const averageProgress =
      goalsThisYear > 0
        ? Math.round(goals.reduce((acc, g) => acc + g.progress, 0) / goalsThisYear)
        : 0;
    const needingAttention = goals.filter(
      (g) => g.status === 'At risk' || g.status === 'Missed',
    ).length;
    const achieved = goals.filter((g) => g.status === 'Achieved').length;

    return {
      goalsThisYear,
      averageProgress,
      needingAttention,
      achieved,
      goals,
    };
  }

  async getTeamGoals(
    viewerId: number,
    filters?: TeamGoalsFilter,
  ): Promise<TeamGoalsSummaryView> {
    const viewer = await this.authService.getCurrentEmployee(viewerId);
    const isAdmin = viewer.tiers.includes('admin');
    const isManager = viewer.tiers.includes('manager');

    if (!isAdmin && !isManager) {
      throw new ApiError(403, 'Team goals are for managers and admins.');
    }

    const roster = await this.orgRepository.findRoster({
      rootId: isAdmin ? null : viewerId,
      includeLeavers: false,
    });

    if (roster.length === 0) {
      return {
        totalGoals: 0,
        onTrack: 0,
        atRisk: 0,
        achievedSoFar: 0,
        members: [],
      };
    }

    const today = await this.clock.today();
    const policy = await this.policyService.getForDate(today);

    const memberIds = roster.map((m) => m.id);
    const goalsMap = await this.goalsRepository.findForEmployees(memberIds, policy.fy);

    // Calculate team-wide summary stats (across all active team goals)
    let totalGoals = 0;
    let onTrack = 0;
    let atRisk = 0;
    let achievedSoFar = 0;

    for (const [, records] of goalsMap) {
      for (const rec of records) {
        const view = this.toView(
          rec,
          policy.fyStart,
          today,
          policy.goalRiskTolerancePct,
        );
        totalGoals++;
        if (view.status === 'On track') onTrack++;
        else if (view.status === 'At risk') atRisk++;
        else if (view.status === 'Achieved') achievedSoFar++;
      }
    }

    // Build member groups with optional filters
    const members: MemberGoalsGroup[] = [];
    const filterPeriod = filters?.period && filters.period !== 'all' ? filters.period : null;
    const filterStatus = filters?.status && filters.status !== 'all' ? filters.status.toLowerCase() : null;
    const filterEmployeeId = filters?.employeeId ? Number(filters.employeeId) : null;

    for (const member of roster) {
      if (filterEmployeeId && member.id !== filterEmployeeId) {
        continue;
      }

      const rawGoals = goalsMap.get(member.id) || [];
      const memberViews = rawGoals.map((g) =>
        this.toView(g, policy.fyStart, today, policy.goalRiskTolerancePct),
      );

      const filteredGoals = memberViews.filter((g) => {
        if (filterPeriod && g.period !== filterPeriod) return false;
        if (filterStatus && g.status.toLowerCase() !== filterStatus) return false;
        return true;
      });

      // If a specific period or status filter is applied, only show members who have matching goals
      if ((filterPeriod || filterStatus) && filteredGoals.length === 0) {
        continue;
      }

      const goalsCount = filteredGoals.length;
      const averageProgress =
        goalsCount > 0
          ? Math.round(filteredGoals.reduce((s, g) => s + g.progress, 0) / goalsCount)
          : 0;

      members.push({
        employeeId: member.id,
        employeeCode: member.employeeCode,
        fullName: member.fullName,
        designation: member.designation,
        department: member.department,
        goalsCount,
        averageProgress,
        goals: filteredGoals,
      });
    }

    return {
      totalGoals,
      onTrack,
      atRisk,
      achievedSoFar,
      members,
    };
  }

  async createGoal(viewerId: number, dto: CreateGoalDto): Promise<GoalView> {
    if (!dto.employeeId || !dto.title?.trim() || !dto.period || !dto.goalType) {
      throw new ApiError(400, 'Please provide employeeId, title, period, and goalType.');
    }

    if (dto.goalType === 'metric') {
      if (dto.targetValue === undefined || dto.targetValue === null || isNaN(Number(dto.targetValue))) {
        throw new ApiError(400, 'Metric goals require a numeric target value.');
      }
    } else if (dto.goalType === 'milestone') {
      if (!dto.milestones || dto.milestones.filter((m) => m.trim().length > 0).length === 0) {
        throw new ApiError(400, 'Checklist goals require at least one milestone.');
      }
    }

    const access = await this.accessService.require(viewerId, dto.employeeId);
    if (!canRecordAbout(access)) {
      throw new ApiError(403, 'Only a manager or admin may set a goal for an employee.');
    }

    const today = await this.clock.today();
    const policy = await this.policyService.getForDate(today);

    const created = await this.goalsRepository.create(dto, policy.fy, viewerId, today);
    return this.toView(created, policy.fyStart, today, policy.goalRiskTolerancePct);
  }

  async updateMetric(viewerId: number, goalId: number, value: number): Promise<GoalView> {
    const goal = await this.goalsRepository.findById(goalId);
    if (!goal) {
      throw new ApiError(404, 'Goal not found.');
    }

    if (goal.goalType !== 'metric') {
      throw new ApiError(400, 'Cannot update metric value on a milestone goal.');
    }

    if (isNaN(value) || value < 0) {
      throw new ApiError(400, 'Current value must be a non-negative number.');
    }

    // Must be employee themselves, their manager, or admin
    await this.accessService.require(viewerId, goal.employeeId);

    await this.goalsRepository.updateMetric(goalId, value);

    const updated = await this.goalsRepository.findById(goalId);
    const today = await this.clock.today();
    const policy = await this.policyService.getForDate(today);

    return this.toView(updated!, policy.fyStart, today, policy.goalRiskTolerancePct);
  }

  async toggleMilestone(
    viewerId: number,
    goalId: number,
    milestoneId: number,
    isDone: boolean,
  ): Promise<GoalView> {
    const goal = await this.goalsRepository.findById(goalId);
    if (!goal) {
      throw new ApiError(404, 'Goal not found.');
    }

    const milestone = goal.milestones.find((m) => m.id === milestoneId);
    if (!milestone) {
      throw new ApiError(404, 'Milestone not found for this goal.');
    }

    // Must be employee themselves, their manager, or admin
    await this.accessService.require(viewerId, goal.employeeId);

    await this.goalsRepository.toggleMilestone(milestoneId, isDone, viewerId);

    const updated = await this.goalsRepository.findById(goalId);
    const today = await this.clock.today();
    const policy = await this.policyService.getForDate(today);

    return this.toView(updated!, policy.fyStart, today, policy.goalRiskTolerancePct);
  }

  async deleteGoal(viewerId: number, goalId: number): Promise<void> {
    const goal = await this.goalsRepository.findById(goalId);
    if (!goal) {
      throw new ApiError(404, 'Goal not found.');
    }

    const access = await this.accessService.require(viewerId, goal.employeeId);
    if (!canRecordAbout(access)) {
      throw new ApiError(403, 'Only a manager or admin may delete a goal.');
    }

    await this.goalsRepository.delete(goalId);
  }

  private toView(
    goal: GoalRecord,
    fyStart: string,
    today: string,
    riskTolerancePct: number,
  ): GoalView {
    const window = periodWindow(goal.period, fyStart);

    return {
      id: goal.id,
      ref: goal.ref,
      employeeId: goal.employeeId,
      employeeName: goal.employeeName,
      title: goal.title,
      goalType: goal.goalType,
      period: goal.period,
      periodLabel: window.label,
      progress: goalProgress(goal),
      status: goalStatus(goal, window, today, riskTolerancePct),
      targetValue: goal.targetValue,
      currentValue: goal.currentValue,
      unit: goal.unit,
      direction: goal.direction,
      note: goal.note,
      setOn: goal.setOn || today,
      setterName: goal.setterName ?? (goal.setBy ? null : 'Board'),
      milestonesDone: goal.milestones.filter((m) => m.isDone).length,
      milestonesTotal: goal.milestones.length,
      milestones: goal.milestones,
    };
  }
}
