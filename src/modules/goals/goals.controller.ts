import { RequestHandler } from 'express';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { ApiError } from '../../utils/api-error';
import { asyncHandler } from '../../utils/async-handler';
import { IGoalsService } from './goals.service.interface';
import { CreateGoalDto, GOAL_LIMITS, UpdateGoalDto } from './goals.model';
import { GoalDirection, GoalPeriod, GoalType } from './goals.domain';

/**
 * Rejects a value the column cannot hold, naming the field and the limit.
 *
 * Checked here rather than left to MySQL because the database's complaint
 * arrives as an unhandled error with the column name and nothing a person can
 * act on. "Notes must be 1000 characters or fewer — you have 1,240" is a
 * sentence someone can do something about.
 */
const assertFits = (label: string, value: string, max: number): void => {
  if (value.length > max) {
    throw ApiError.badRequest(
      `${label} must be ${max} characters or fewer — you have ${value.length.toLocaleString('en-IN')}.`,
    );
  }
};

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

    // No employee given means "my own goal". The person proposing it is already
    // known from the session, so My Goals need not — and should not — send an
    // id the server would only have to check against itself. The service then
    // files a self-set goal as pending until the manager approves it.
    const rawEmployeeId = body.employeeId;
    const omitted =
      rawEmployeeId === undefined || rawEmployeeId === null || rawEmployeeId === '' || rawEmployeeId === 0;
    const targetEmployeeId = omitted ? viewerId : Number(rawEmployeeId);
    if (!Number.isInteger(targetEmployeeId) || targetEmployeeId <= 0) {
      throw ApiError.badRequest('employeeId must be a valid employee id.');
    }

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      throw ApiError.badRequest('Goal title is required.');
    }
    assertFits('Goal title', title, GOAL_LIMITS.title);
    assertFits('Unit', typeof body.unit === 'string' ? body.unit.trim() : '', GOAL_LIMITS.unit);
    assertFits('Notes', typeof body.note === 'string' ? body.note.trim() : '', GOAL_LIMITS.note);

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

  update: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId: viewerId } = req as AuthenticatedRequest;
    const goalId = Number(req.params.id);
    if (!goalId || isNaN(goalId)) {
      throw ApiError.badRequest('Valid goal id is required.');
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      throw ApiError.badRequest('Goal title is required.');
    }
    assertFits('Goal title', title, GOAL_LIMITS.title);
    assertFits('Unit', typeof body.unit === 'string' ? body.unit.trim() : '', GOAL_LIMITS.unit);
    assertFits('Notes', typeof body.note === 'string' ? body.note.trim() : '', GOAL_LIMITS.note);

    const goalType = body.goalType as GoalType;
    if (goalType !== 'metric' && goalType !== 'milestone') {
      throw ApiError.badRequest('goalType must be "metric" or "milestone".');
    }

    const validPeriods: GoalPeriod[] = ['Q1', 'Q2', 'Q3', 'Q4', 'H1', 'H2', 'FY'];
    const period = body.period as GoalPeriod;
    if (!validPeriods.includes(period)) {
      throw ApiError.badRequest(`period must be one of: ${validPeriods.join(', ')}`);
    }

    const dto: UpdateGoalDto = {
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

    const data = await this.goalsService.updateGoal(viewerId, goalId, dto);
    res.json({ success: true, data });
  });

  approve: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId: viewerId } = req as AuthenticatedRequest;
    const goalId = Number(req.params.id);
    if (!goalId || isNaN(goalId)) {
      throw ApiError.badRequest('Valid goal id is required.');
    }

    const data = await this.goalsService.approveGoal(viewerId, goalId);
    res.json({ success: true, data, message: 'Goal approved successfully.' });
  });

  reject: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId: viewerId } = req as AuthenticatedRequest;
    const goalId = Number(req.params.id);
    if (!goalId || isNaN(goalId)) {
      throw ApiError.badRequest('Valid goal id is required.');
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : null;

    const data = await this.goalsService.rejectGoal(viewerId, goalId, reason);
    res.json({ success: true, data, message: 'Goal rejected.' });
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
