import { AddProjectInput, ProjectRecord } from './projects.model';

export interface IProjectsRepository {
  /**
   * Everything recorded for this employee, most recent first.
   *
   * Live work leads, because that is what somebody opening the page wants to
   * know; finished work follows in the order it was added.
   */
  findForEmployee(employeeId: number): Promise<ProjectRecord[]>;

  /** Records a project and returns it as stored, author's name resolved. */
  add(input: AddProjectInput): Promise<ProjectRecord>;
}
