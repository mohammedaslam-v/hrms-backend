import {
  ProjectRecord,
  ProjectStatus,
  ProjectType,
  TaskStatus,
  UpdateProjectInput,
  UpdateTaskInput,
} from "./projects.model";

export interface IProjectsService {
  getForEmployee(employeeId: number): Promise<ProjectRecord[]>;

  add(
    authorId: number,
    employeeId: number,
    input: {
      type?: ProjectType;
      title: string;
      status: ProjectStatus;
      note: string | null;
      startedOn: string | null;
    },
  ): Promise<ProjectRecord[]>;

  update(
    authorId: number,
    projectId: number,
    input: UpdateProjectInput,
  ): Promise<ProjectRecord[]>;

  delete(authorId: number, projectId: number): Promise<ProjectRecord[]>;

  addTask(
    authorId: number,
    projectId: number,
    input: {
      parentTaskId?: number | null;
      title: string;
      status?: TaskStatus;
      note?: string | null;
      dueDate?: string | null;
    },
  ): Promise<ProjectRecord[]>;

  updateTask(
    authorId: number,
    taskId: number,
    input: UpdateTaskInput,
  ): Promise<ProjectRecord[]>;

  deleteTask(authorId: number, taskId: number): Promise<ProjectRecord[]>;
}
