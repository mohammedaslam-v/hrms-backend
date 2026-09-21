import { canManageProjects } from "../access/access.domain";
import { IAccessService } from "../access/access.service.interface";
import { recordAudit } from "../../shared/audit";
import { ApiError } from "../../utils/api-error";
import {
  ProjectRecord,
  ProjectStatus,
  ProjectType,
  TaskStatus,
  UpdateProjectInput,
  UpdateTaskInput,
} from "./projects.model";
import { IProjectsRepository } from "./projects.repository.interface";
import { IProjectsService } from "./projects.service.interface";
import type { Pool } from "mysql2/promise";

export class ProjectsService implements IProjectsService {
  constructor(
    private readonly projectsRepository: IProjectsRepository,
    private readonly accessService: IAccessService,
    private readonly pool: Pool,
  ) {}

  getForEmployee(employeeId: number): Promise<ProjectRecord[]> {
    return this.projectsRepository.findForEmployee(employeeId);
  }

  async add(
    authorId: number,
    employeeId: number,
    input: {
      type?: ProjectType;
      title: string;
      status: ProjectStatus;
      note: string | null;
      startedOn: string | null;
    },
  ): Promise<ProjectRecord[]> {
    const access = await this.accessService.require(authorId, employeeId);
    if (!canManageProjects(access)) {
      throw new ApiError(403, "You do not have permission to add a project for this profile.");
    }

    const title = input.title.trim();
    if (!title) throw ApiError.badRequest("Give the project or achievement a title.");

    const stored = await this.projectsRepository.add({
      employeeId,
      type: input.type || "project",
      title,
      status: input.status,
      note: input.note?.trim() || null,
      startedOn: input.startedOn,
      addedBy: authorId,
    });

    await recordAudit(this.pool, {
      actorEmployeeId: authorId,
      action: "project.added",
      entityType: "hrms_employee_projects",
      entityId: stored.id,
      before: null,
      after: { employeeId, type: stored.type, title: stored.title, status: stored.status },
    });

    return this.getForEmployee(employeeId);
  }

  async update(
    authorId: number,
    projectId: number,
    input: UpdateProjectInput,
  ): Promise<ProjectRecord[]> {
    const owner = await this.projectsRepository.findProjectOwner(projectId);
    if (!owner) throw ApiError.notFound("Project not found.");

    const access = await this.accessService.require(authorId, owner.employeeId);
    if (!canManageProjects(access)) {
      throw new ApiError(403, "You do not have permission to update this project.");
    }

    if (input.title !== undefined && !input.title.trim()) {
      throw ApiError.badRequest("Project title cannot be empty.");
    }

    await this.projectsRepository.update(projectId, {
      ...input,
      title: input.title?.trim(),
      note: input.note !== undefined ? (input.note?.trim() || null) : undefined,
    });

    await recordAudit(this.pool, {
      actorEmployeeId: authorId,
      action: "project.updated",
      entityType: "hrms_employee_projects",
      entityId: projectId,
      before: null,
      after: input,
    });

    return this.getForEmployee(owner.employeeId);
  }

  async delete(authorId: number, projectId: number): Promise<ProjectRecord[]> {
    const owner = await this.projectsRepository.findProjectOwner(projectId);
    if (!owner) throw ApiError.notFound("Project not found.");

    const access = await this.accessService.require(authorId, owner.employeeId);
    if (!canManageProjects(access)) {
      throw new ApiError(403, "You do not have permission to delete this project.");
    }

    await this.projectsRepository.delete(projectId);

    await recordAudit(this.pool, {
      actorEmployeeId: authorId,
      action: "project.deleted",
      entityType: "hrms_employee_projects",
      entityId: projectId,
      before: { id: projectId, employeeId: owner.employeeId },
      after: null,
    });

    return this.getForEmployee(owner.employeeId);
  }

  async addTask(
    authorId: number,
    projectId: number,
    input: {
      parentTaskId?: number | null;
      title: string;
      status?: TaskStatus;
      note?: string | null;
      dueDate?: string | null;
    },
  ): Promise<ProjectRecord[]> {
    const owner = await this.projectsRepository.findProjectOwner(projectId);
    if (!owner) throw ApiError.notFound("Project not found.");

    const access = await this.accessService.require(authorId, owner.employeeId);
    if (!canManageProjects(access)) {
      throw new ApiError(403, "You do not have permission to add tasks to this project.");
    }

    const title = input.title.trim();
    if (!title) throw ApiError.badRequest("Give the task a title.");

    await this.projectsRepository.addTask({
      projectId,
      parentTaskId: input.parentTaskId || null,
      title,
      status: input.status || "Pending",
      note: input.note?.trim() || null,
      dueDate: input.dueDate || null,
      addedBy: authorId,
    });

    return this.getForEmployee(owner.employeeId);
  }

  async updateTask(
    authorId: number,
    taskId: number,
    input: UpdateTaskInput,
  ): Promise<ProjectRecord[]> {
    const owner = await this.projectsRepository.findTaskOwner(taskId);
    if (!owner) throw ApiError.notFound("Task not found.");

    const access = await this.accessService.require(authorId, owner.employeeId);
    if (!canManageProjects(access)) {
      throw new ApiError(403, "You do not have permission to update this task.");
    }

    if (input.title !== undefined && !input.title.trim()) {
      throw ApiError.badRequest("Task title cannot be empty.");
    }

    await this.projectsRepository.updateTask(taskId, {
      ...input,
      title: input.title?.trim(),
      note: input.note !== undefined ? (input.note?.trim() || null) : undefined,
    });

    return this.getForEmployee(owner.employeeId);
  }

  async deleteTask(authorId: number, taskId: number): Promise<ProjectRecord[]> {
    const owner = await this.projectsRepository.findTaskOwner(taskId);
    if (!owner) throw ApiError.notFound("Task not found.");

    const access = await this.accessService.require(authorId, owner.employeeId);
    if (!canManageProjects(access)) {
      throw new ApiError(403, "You do not have permission to delete this task.");
    }

    await this.projectsRepository.deleteTask(taskId);

    return this.getForEmployee(owner.employeeId);
  }
}
