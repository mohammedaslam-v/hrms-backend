import { RequestHandler } from 'express';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { ApiError } from '../../utils/api-error';
import { asyncHandler } from '../../utils/async-handler';
import { ProjectStatus } from './projects.model';
import { IProjectsService } from './projects.service.interface';

const STATUSES: ProjectStatus[] = ['In progress', 'Live', 'Done'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ProjectsController {
  constructor(private readonly projectsService: IProjectsService) {}

  /** The author is always the session — never a field the client can supply. */
  add: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId: authorId } = req as AuthenticatedRequest;
    const subjectId = this.readId(req.params.employeeId);
    const body = (req.body ?? {}) as Record<string, unknown>;

    const status = STATUSES.includes(body.status as ProjectStatus)
      ? (body.status as ProjectStatus)
      : 'In progress';

    const startedOn =
      typeof body.startedOn === 'string' && ISO_DATE.test(body.startedOn) ? body.startedOn : null;

    const data = await this.projectsService.add(authorId, subjectId, {
      title: typeof body.title === 'string' ? body.title : '',
      status,
      note: typeof body.note === 'string' ? body.note : null,
      startedOn,
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
