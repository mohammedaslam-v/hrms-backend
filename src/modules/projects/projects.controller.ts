import { RequestHandler } from "express";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware";
import { ApiError } from "../../utils/api-error";
import { asyncHandler } from "../../utils/async-handler";
import { ProjectStatus, ProjectType, TaskStatus } from "./projects.model";
import { IProjectsService } from "./projects.service.interface";

const STATUSES: ProjectStatus[] = ["In progress", "Live", "Done"];
const TASK_STATUSES: TaskStatus[] = ["Pending", "In progress", "Done"];
const PROJECT_TYPES: ProjectType[] = ["project", "achievement"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ProjectsController {
  constructor(private readonly projectsService: IProjectsService) {}

  add: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId: authorId } = req as AuthenticatedRequest;
    const subjectId = this.readId(req.params.employeeId, "employeeId");
    const body = (req.body ?? {}) as Record<string, unknown>;

    const type = PROJECT_TYPES.includes(body.type as ProjectType)
      ? (body.type as ProjectType)
      : "project";

    const status = STATUSES.includes(body.status as ProjectStatus)
      ? (body.status as ProjectStatus)
      : "In progress";

    const startedOn =
      typeof body.startedOn === "string" && ISO_DATE.test(body.startedOn) ? body.startedOn : null;

    const data = await this.projectsService.add(authorId, subjectId, {
      type,
      title: typeof body.title === "string" ? body.title : "",
      status,
      note: typeof body.note === "string" ? body.note : null,
      startedOn,
    });

    res.status(201).json({ success: true, data });
  });

  update: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId: authorId } = req as AuthenticatedRequest;
    const projectId = this.readId(req.params.projectId, "projectId");
    const body = (req.body ?? {}) as Record<string, unknown>;

    const input: any = {};
    if (body.type && PROJECT_TYPES.includes(body.type as ProjectType)) {
      input.type = body.type;
    }
    if (typeof body.title === "string") {
      input.title = body.title;
    }
    if (body.status && STATUSES.includes(body.status as ProjectStatus)) {
      input.status = body.status;
    }
    if (body.note !== undefined) {
      input.note = typeof body.note === "string" ? body.note : null;
    }
    if (body.startedOn !== undefined) {
      input.startedOn = typeof body.startedOn === "string" && ISO_DATE.test(body.startedOn) ? body.startedOn : null;
    }

    const data = await this.projectsService.update(authorId, projectId, input);
    res.status(200).json({ success: true, data });
  });

  delete: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId: authorId } = req as AuthenticatedRequest;
    const projectId = this.readId(req.params.projectId, "projectId");

    const data = await this.projectsService.delete(authorId, projectId);
    res.status(200).json({ success: true, data });
  });

  addTask: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId: authorId } = req as AuthenticatedRequest;
    const projectId = this.readId(req.params.projectId, "projectId");
    const body = (req.body ?? {}) as Record<string, unknown>;

    const status = TASK_STATUSES.includes(body.status as TaskStatus)
      ? (body.status as TaskStatus)
      : "Pending";

    const dueDate =
      typeof body.dueDate === "string" && ISO_DATE.test(body.dueDate) ? body.dueDate : null;

    const parentTaskId = body.parentTaskId ? Number(body.parentTaskId) : null;

    const data = await this.projectsService.addTask(authorId, projectId, {
      parentTaskId: Number.isInteger(parentTaskId) && (parentTaskId as number) > 0 ? parentTaskId : null,
      title: typeof body.title === "string" ? body.title : "",
      status,
      note: typeof body.note === "string" ? body.note : null,
      dueDate,
    });

    res.status(201).json({ success: true, data });
  });

  updateTask: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId: authorId } = req as AuthenticatedRequest;
    const taskId = this.readId(req.params.taskId, "taskId");
    const body = (req.body ?? {}) as Record<string, unknown>;

    const input: any = {};
    if (typeof body.title === "string") {
      input.title = body.title;
    }
    if (body.status && TASK_STATUSES.includes(body.status as TaskStatus)) {
      input.status = body.status;
    }
    if (body.note !== undefined) {
      input.note = typeof body.note === "string" ? body.note : null;
    }
    if (body.dueDate !== undefined) {
      input.dueDate = typeof body.dueDate === "string" && ISO_DATE.test(body.dueDate) ? body.dueDate : null;
    }

    const data = await this.projectsService.updateTask(authorId, taskId, input);
    res.status(200).json({ success: true, data });
  });

  deleteTask: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId: authorId } = req as AuthenticatedRequest;
    const taskId = this.readId(req.params.taskId, "taskId");

    const data = await this.projectsService.deleteTask(authorId, taskId);
    res.status(200).json({ success: true, data });
  });

  private readId(raw: unknown, paramName: string): number {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      throw ApiError.badRequest(`${paramName} must be a positive integer`);
    }
    return id;
  }
}
