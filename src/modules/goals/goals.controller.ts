import { RequestHandler } from 'express';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { ApiError } from '../../utils/api-error';
import { asyncHandler } from '../../utils/async-handler';
import { IGoalsService } from './goals.service.interface';
import { CreateGoalDto } from './goals.model';
import { GoalDirection, GoalPeriod, GoalType } from './goals.domain';

export class GoalsController {
  constructor(private readonly goalsService: IGoalsService) {}

  getMine: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const data = await this.goalsService.getMyGoals(employeeId);
    res.json({ success: true, data });
  });

  getTeam: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const period = typeof req.query.period === 'string' ? req.query.period : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const empId = req.query.employeeId ? Number(req.query.employeeId) : undefined;

    const data = await this.goalsService.getTeamGoals(employeeId, {
      period,
      status,
      employeeId: empId && !isNaN(empId) ? empId : undefined,
    });
    res.json({ success: true, data });
  });

  create: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId: viewerId } = req as AuthenticatedRequest;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const targetEmployeeId = Number(body.employeeId);
    if (!targetEmployeeId || isNaN(targetEmployeeId)) {
      throw ApiError.badRequest('employeeId is required and must be a number.');
    }

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      throw ApiError.badRequest('Goal title is required.');
    }

    const goalType = body.goalType as GoalType;
    if (goalType !== 'metric' && goalType !== 'milestone') {
      throw ApiError.badRequest('goalType must be "metric" or "milestone".');
    }

    const validPeriods: GoalPeriod[] = ['Q1', 'Q2', 'Q3', 'Q4', 'H1', 'H2', 'FY'];
    const period = body.period as GoalPeriod;
    if (!validPeriods.includes(period)) {
      throw ApiError.badRequest(`period must be one of: ${validPeriods.join(', ')}`);
    }

    const dto: CreateGoalDto = {
      employeeId: targetEmployeeId,
      title,
      goalType,
      period,
      targetValue: body.targetValue !== undefined && body.targetValue !== null ? Number(body.targetValue) : null,
      currentValue: body.currentValue !== undefined && body.currentValue !== null ? Number(body.currentValue) : null,
      unit: typeof body.unit === 'string' ? body.unit.trim() : null,
      direction: (body.direction as GoalDirection) === 'down' ? 'down' : 'up',
      note: typeof body.note === 'string' ? body.note.trim() : null,
      milestones: Array.isArray(body.milestones)
        ? body.milestones.map((m) => String(m).trim()).filter((m) => m.length > 0)
        : [],
    };

    const data = await this.goalsService.createGoal(viewerId, dto);
    res.status(201).json({ success: true, data });
  });

  updateMetric: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId: viewerId } = req as AuthenticatedRequest;
    const goalId = Number(req.params.id);
    if (!goalId || isNaN(goalId)) {
      throw ApiError.badRequest('Valid goal id is required.');
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.currentValue === undefined || isNaN(Number(body.currentValue))) {
      throw ApiError.badRequest('currentValue must be a valid number.');
    }

    const data = await this.goalsService.updateMetric(viewerId, goalId, Number(body.currentValue));
    res.json({ success: true, data });
  });

  toggleMilestone: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId: viewerId } = req as AuthenticatedRequest;
    const goalId = Number(req.params.id);
    const milestoneId = Number(req.params.milestoneId);

    if (!goalId || isNaN(goalId) || !milestoneId || isNaN(milestoneId)) {
      throw ApiError.badRequest('Valid goal id and milestone id are required.');
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const isDone = Boolean(body.isDone);

    const data = await this.goalsService.toggleMilestone(viewerId, goalId, milestoneId, isDone);
    res.json({ success: true, data });
  });

  delete: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId: viewerId } = req as AuthenticatedRequest;
    const goalId = Number(req.params.id);
    if (!goalId || isNaN(goalId)) {
      throw ApiError.badRequest('Valid goal id is required.');
    }

    await this.goalsService.deleteGoal(viewerId, goalId);
    res.json({ success: true, message: 'Goal deleted successfully.' });
  });
}
