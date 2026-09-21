export type ProjectType = "project" | "achievement";
export type ProjectStatus = "In progress" | "Live" | "Done";
export type TaskStatus = "Pending" | "In progress" | "Done";

export interface ProjectTaskRecord {
  id: number;
  projectId: number;
  parentTaskId: number | null;
  title: string;
  status: TaskStatus;
  note: string | null;
  dueDate: string | null;
  addedBy: number;
  addedByName: string | null;
  createdAt: string;
  subtasks: ProjectTaskRecord[];
}

export interface TaskStats {
  total: number;
  done: number;
  inProgress: number;
  pending: number;
}

/**
 * A project or milestone achievement someone is known for.
 */
export interface ProjectRecord {
  id: number;
  employeeId: number;
  type: ProjectType;
  title: string;
  status: ProjectStatus;
  note: string | null;
  startedOn: string | null;
  addedBy: number;
  addedByName: string | null;
  tasks: ProjectTaskRecord[];
  taskStats: TaskStats;
}

export interface AddProjectInput {
  employeeId: number;
  type: ProjectType;
  title: string;
  status: ProjectStatus;
  note: string | null;
  startedOn: string | null;
  addedBy: number;
}

export interface UpdateProjectInput {
  type?: ProjectType;
  title?: string;
  status?: ProjectStatus;
  note?: string | null;
  startedOn?: string | null;
}

export interface AddTaskInput {
  projectId: number;
  parentTaskId?: number | null;
  title: string;
  status?: TaskStatus;
  note?: string | null;
  dueDate?: string | null;
  addedBy: number;
}

export interface UpdateTaskInput {
  title?: string;
  status?: TaskStatus;
  note?: string | null;
  dueDate?: string | null;
}
