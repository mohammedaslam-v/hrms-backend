import { RequestHandler } from 'express';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { ApiError } from '../../utils/api-error';
import { asyncHandler } from '../../utils/async-handler';
import { FeedbackVisibility } from './feedback.model';
import { IFeedbackService } from './feedback.service.interface';

export class FeedbackController {
  constructor(private readonly feedbackService: IFeedbackService) {}

  add: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId: authorId } = req as AuthenticatedRequest;
    const subjectId = this.readId(req.params.employeeId);
    const body = (req.body ?? {}) as Record<string, unknown>;

    // Anything but the explicit opt-out is visible to the employee. Withholding
    // a note has to be a deliberate choice, not the result of a missing field.
    const visibility: FeedbackVisibility =
      body.visibility === 'managers_only' ? 'managers_only' : 'employee';

    const data = await this.feedbackService.add(authorId, subjectId, {
      body: typeof body.body === 'string' ? body.body : '',
      visibility,
    });

    res.status(201).json({ success: true, data });
  });

  private readId(raw: unknown): number {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      throw ApiError.badRequest('employeeId must be a positive integer');
    }
    return id;
  }
}
