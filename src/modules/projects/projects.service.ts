import { canRecordAbout } from '../access/access.domain';
import { IAccessService } from '../access/access.service.interface';
import { recordAudit } from '../../shared/audit';
import { ApiError } from '../../utils/api-error';
import { ProjectRecord, ProjectStatus } from './projects.model';
import { IProjectsRepository } from './projects.repository.interface';
import { IProjectsService } from './projects.service.interface';
import type { Pool } from 'mysql2/promise';

/**
 * Projects and achievements.
 *
 * Reading is open to anyone who can open the profile — a project is work, not a
 * secret. Writing is not: a record on somebody's profile is written by their
 * manager or an admin, never by themselves.
 */
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
    input: { title: string; status: ProjectStatus; note: string | null; startedOn: string | null },
  ): Promise<ProjectRecord[]> {
    const access = await this.accessService.require(authorId, employeeId);
    if (!canRecordAbout(access)) {
      throw new ApiError(
        403,
        'Only a manager or an admin can add a project, and not to their own record.',
      );
    }

    const title = input.title.trim();
    if (!title) throw ApiError.badRequest('Give the project a title.');

    const stored = await this.projectsRepository.add({
      employeeId,
      title,
      status: input.status,
      note: input.note?.trim() || null,
      startedOn: input.startedOn,
      addedBy: authorId,
    });

    await recordAudit(this.pool, {
      actorEmployeeId: authorId,
      action: 'project.added',
      entityType: 'hrms_employee_projects',
      entityId: stored.id,
      before: null,
      after: { employeeId, title: stored.title, status: stored.status },
    });

    return this.getForEmployee(employeeId);
  }
}
