import { ProjectRecord, ProjectStatus } from './projects.model';

export interface IProjectsService {
  /**
   * This employee's projects. Read only for now — adding one is a manager
   * action and belongs with the write path, so the rules for it live in one
   * place rather than being reimplemented by every screen that lists them.
   */
  getForEmployee(employeeId: number): Promise<ProjectRecord[]>;

  /**
   * Record a project against someone. Refuses unless the author manages them or
   * holds admin — and refuses for your own record, whoever you are.
   */
  add(
    authorId: number,
    employeeId: number,
    input: { title: string; status: ProjectStatus; note: string | null; startedOn: string | null },
  ): Promise<ProjectRecord[]>;
}
