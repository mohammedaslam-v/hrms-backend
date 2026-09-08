import { IPolicyService } from '../policy/policy.service.interface';
import { IClock } from '../../shared/clock';
import { GoalRecord, goalProgress, goalStatus, periodWindow } from './goals.domain';
import { GoalView } from './goals.model';
import { IGoalsRepository } from './goals.repository.interface';
import { IGoalsService } from './goals.service.interface';

/**
 * Goals.
 *
 * Thin by design: it fetches, then hands every judgement to the domain. The
 * period dates come from the configured financial year and the risk tolerance
 * from company policy, so neither is a constant anybody has to remember to
 * change in two places.
 */
export class GoalsService implements IGoalsService {
  constructor(
    private readonly goalsRepository: IGoalsRepository,
    private readonly policyService: IPolicyService,
    private readonly clock: IClock,
  ) {}

  async getForEmployee(employeeId: number): Promise<GoalView[]> {
    // The database's day, not this process's — see IClock.
    const today = await this.clock.today();
    const policy = await this.policyService.getForDate(today);
    const goals = await this.goalsRepository.findForEmployee(employeeId, policy.fy);

    return goals.map((goal) => this.toView(goal, policy.fyStart, today, policy.goalRiskTolerancePct));
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
      title: goal.title,
      goalType: goal.goalType,
      period: goal.period,
      periodLabel: window.label,
      // Both derived on every read, so ticking a milestone cannot leave a stale
      // percentage behind it.
      progress: goalProgress(goal),
      status: goalStatus(goal, window, today, riskTolerancePct),
      targetValue: goal.targetValue,
      currentValue: goal.currentValue,
      unit: goal.unit,
      note: goal.note,
      milestonesDone: goal.milestones.filter((m) => m.isDone).length,
      milestonesTotal: goal.milestones.length,
    };
  }
}
