import {
  AddProjectInput,
  AddTaskInput,
  ProjectRecord,
  ProjectTaskRecord,
  UpdateProjectInput,
  UpdateTaskInput,
} from "./projects.model";

export interface IProjectsRepository {
  findForEmployee(employeeId: number): Promise<ProjectRecord[]>;
  findById(id: number): Promise<ProjectRecord | null>;
  add(input: AddProjectInput): Promise<ProjectRecord>;
  update(id: number, input: UpdateProjectInput): Promise<ProjectRecord>;
  delete(id: number): Promise<void>;

  addTask(input: AddTaskInput): Promise<ProjectTaskRecord>;
  updateTask(id: number, input: UpdateTaskInput): Promise<ProjectTaskRecord>;
  deleteTask(id: number): Promise<void>;

  findProjectOwner(id: number): Promise<{ employeeId: number; addedBy: number } | null>;
  findTaskOwner(taskId: number): Promise<{ projectId: number; employeeId: number; addedBy: number } | null>;
}
