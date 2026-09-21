import { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  AddProjectInput,
  AddTaskInput,
  ProjectRecord,
  ProjectStatus,
  ProjectTaskRecord,
  ProjectType,
  TaskStats,
  TaskStatus,
  UpdateProjectInput,
  UpdateTaskInput,
} from "./projects.model";
import { IProjectsRepository } from "./projects.repository.interface";

interface ProjectRow extends RowDataPacket {
  id: number;
  employee_id: number;
  type?: ProjectType;
  title: string;
  status: ProjectStatus;
  note: string | null;
  started_on: string | null;
  added_by: number;
  added_by_name: string | null;
}

interface TaskRow extends RowDataPacket {
  id: number;
  project_id: number;
  parent_task_id: number | null;
  title: string;
  status: TaskStatus;
  note: string | null;
  due_date: string | null;
  added_by: number;
  added_by_name: string | null;
  created_at: Date | string;
}

export class ProjectsRepository implements IProjectsRepository {
  constructor(private readonly pool: Pool) {}

  async add(input: AddProjectInput): Promise<ProjectRecord> {
    try {
      const [result] = await this.pool.execute<ResultSetHeader>(
        `INSERT INTO hrms_employee_projects
           (employee_id, type, title, status, note, started_on, added_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          input.employeeId,
          input.type || "project",
          input.title,
          input.status,
          input.note,
          input.startedOn,
          input.addedBy,
        ],
      );
      const stored = await this.findById(result.insertId);
      if (!stored) throw new Error("Project was inserted but could not be read back");
      return stored;
    } catch (err: any) {
      if (err.code === "ER_BAD_FIELD_ERROR" || (err.message && err.message.includes("type"))) {
        // Fallback if user has not yet run ALTER TABLE
        const [result] = await this.pool.execute<ResultSetHeader>(
          `INSERT INTO hrms_employee_projects
             (employee_id, title, status, note, started_on, added_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [input.employeeId, input.title, input.status, input.note, input.startedOn, input.addedBy],
        );
        const stored = await this.findById(result.insertId);
        if (!stored) throw new Error("Project was inserted but could not be read back");
        return stored;
      }
      throw err;
    }
  }

  async update(id: number, input: UpdateProjectInput): Promise<ProjectRecord> {
    const fields: string[] = [];
    const values: any[] = [];

    if (input.type !== undefined) {
      fields.push("type = ?");
      values.push(input.type);
    }
    if (input.title !== undefined) {
      fields.push("title = ?");
      values.push(input.title);
    }
    if (input.status !== undefined) {
      fields.push("status = ?");
      values.push(input.status);
    }
    if (input.note !== undefined) {
      fields.push("note = ?");
      values.push(input.note);
    }
    if (input.startedOn !== undefined) {
      fields.push("started_on = ?");
      values.push(input.startedOn);
    }

    if (fields.length > 0) {
      values.push(id);
      try {
        await this.pool.execute(
          `UPDATE hrms_employee_projects SET ${fields.join(", ")} WHERE id = ?`,
          values,
        );
      } catch (err: any) {
        if (err.code === "ER_BAD_FIELD_ERROR" && fields.some((f) => f.startsWith("type"))) {
          const fallbackFields = fields.filter((f) => !f.startsWith("type"));
          const fallbackValues = values.filter((_, i) => !fields[i]?.startsWith("type"));
          if (fallbackFields.length > 0) {
            await this.pool.execute(
              `UPDATE hrms_employee_projects SET ${fallbackFields.join(", ")} WHERE id = ?`,
              fallbackValues,
            );
          }
        } else {
          throw err;
        }
      }
    }

    const stored = await this.findById(id);
    if (!stored) throw new Error("Project not found after update");
    return stored;
  }

  async delete(id: number): Promise<void> {
    try {
      await this.pool.execute(`DELETE FROM hrms_project_tasks WHERE project_id = ?`, [id]);
    } catch {
      // ignore if table does not exist
    }
    await this.pool.execute(`DELETE FROM hrms_employee_projects WHERE id = ?`, [id]);
  }

  async findById(id: number): Promise<ProjectRecord | null> {
    const [rows] = await this.pool.execute<ProjectRow[]>(
      `SELECT p.*, a.full_name AS added_by_name
         FROM hrms_employee_projects p
         LEFT JOIN hrms_employees a ON a.id = p.added_by
        WHERE p.id = ?`,
      [id],
    );
    if (!rows.length) return null;

    const row = rows[0];
    const tasks = await this.findTasksForProjects([row.id]);
    const projectTasks = tasks.get(row.id) || [];
    const taskStats = this.computeStats(projectTasks);

    return {
      id: row.id,
      employeeId: row.employee_id,
      type: (row.type as ProjectType) || "project",
      title: row.title,
      status: row.status,
      note: row.note,
      startedOn: row.started_on ? String(row.started_on).slice(0, 10) : null,
      addedBy: row.added_by,
      addedByName: row.added_by_name,
      tasks: projectTasks,
      taskStats,
    };
  }

  async findForEmployee(employeeId: number): Promise<ProjectRecord[]> {
    const [rows] = await this.pool.execute<ProjectRow[]>(
      `SELECT p.*, a.full_name AS added_by_name
         FROM hrms_employee_projects p
         LEFT JOIN hrms_employees a ON a.id = p.added_by
        WHERE p.employee_id = ?
        ORDER BY FIELD(p.status, "Live", "In progress", "Done"),
                 p.started_on DESC, p.id DESC`,
      [employeeId],
    );

    if (rows.length === 0) return [];

    const projectIds = rows.map((r) => r.id);
    const tasksByProject = await this.findTasksForProjects(projectIds);

    return rows.map((row) => {
      const tasks = tasksByProject.get(row.id) || [];
      return {
        id: row.id,
        employeeId: row.employee_id,
        type: (row.type as ProjectType) || "project",
        title: row.title,
        status: row.status,
        note: row.note,
        startedOn: row.started_on ? String(row.started_on).slice(0, 10) : null,
        addedBy: row.added_by,
        addedByName: row.added_by_name,
        tasks,
        taskStats: this.computeStats(tasks),
      };
    });
  }

  private async findTasksForProjects(
    projectIds: number[],
  ): Promise<Map<number, ProjectTaskRecord[]>> {
    const map = new Map<number, ProjectTaskRecord[]>();
    if (!projectIds.length) return map;

    try {
      const placeholders = projectIds.map(() => "?").join(",");
      const [rows] = await this.pool.execute<TaskRow[]>(
        `SELECT t.*, a.full_name AS added_by_name
           FROM hrms_project_tasks t
           LEFT JOIN hrms_employees a ON a.id = t.added_by
          WHERE t.project_id IN (${placeholders})
          ORDER BY t.created_at ASC, t.id ASC`,
        projectIds,
      );

      // Group into root tasks and subtasks
      const rootsByProject = new Map<number, ProjectTaskRecord[]>();
      const subtasksByParent = new Map<number, ProjectTaskRecord[]>();

      for (const row of rows) {
        const task: ProjectTaskRecord = {
          id: row.id,
          projectId: row.project_id,
          parentTaskId: row.parent_task_id,
          title: row.title,
          status: row.status,
          note: row.note,
          dueDate: row.due_date ? String(row.due_date).slice(0, 10) : null,
          addedBy: row.added_by,
          addedByName: row.added_by_name,
          createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
          subtasks: [],
        };

        if (task.parentTaskId) {
          const list = subtasksByParent.get(task.parentTaskId) || [];
          list.push(task);
          subtasksByParent.set(task.parentTaskId, list);
        } else {
          const list = rootsByProject.get(task.projectId) || [];
          list.push(task);
          rootsByProject.set(task.projectId, list);
        }
      }

      // Attach subtasks to root tasks
      for (const [projectId, rootTasks] of rootsByProject.entries()) {
        for (const root of rootTasks) {
          root.subtasks = subtasksByParent.get(root.id) || [];
        }
        map.set(projectId, rootTasks);
      }

      return map;
    } catch (err: any) {
      // If table does not exist yet, return empty map
      if (err.code === "ER_NO_SUCH_TABLE" || (err.message && err.message.includes("hrms_project_tasks"))) {
        return map;
      }
      throw err;
    }
  }

  private computeStats(rootTasks: ProjectTaskRecord[]): TaskStats {
    let total = 0;
    let done = 0;
    let inProgress = 0;
    let pending = 0;

    const countTask = (t: ProjectTaskRecord) => {
      total += 1;
      if (t.status === "Done") done += 1;
      else if (t.status === "In progress") inProgress += 1;
      else pending += 1;

      for (const sub of t.subtasks) {
        countTask(sub);
      }
    };

    for (const root of rootTasks) {
      countTask(root);
    }

    return { total, done, inProgress, pending };
  }

  async addTask(input: AddTaskInput): Promise<ProjectTaskRecord> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO hrms_project_tasks
         (project_id, parent_task_id, title, status, note, due_date, added_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.projectId,
        input.parentTaskId || null,
        input.title,
        input.status || "Pending",
        input.note || null,
        input.dueDate || null,
        input.addedBy,
      ],
    );

    const [rows] = await this.pool.execute<TaskRow[]>(
      `SELECT t.*, a.full_name AS added_by_name
         FROM hrms_project_tasks t
         LEFT JOIN hrms_employees a ON a.id = t.added_by
        WHERE t.id = ?`,
      [result.insertId],
    );

    const row = rows[0];
    return {
      id: row.id,
      projectId: row.project_id,
      parentTaskId: row.parent_task_id,
      title: row.title,
      status: row.status,
      note: row.note,
      dueDate: row.due_date ? String(row.due_date).slice(0, 10) : null,
      addedBy: row.added_by,
      addedByName: row.added_by_name,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      subtasks: [],
    };
  }

  async updateTask(id: number, input: UpdateTaskInput): Promise<ProjectTaskRecord> {
    const fields: string[] = [];
    const values: any[] = [];

    if (input.title !== undefined) {
      fields.push("title = ?");
      values.push(input.title);
    }
    if (input.status !== undefined) {
      fields.push("status = ?");
      values.push(input.status);
    }
    if (input.note !== undefined) {
      fields.push("note = ?");
      values.push(input.note);
    }
    if (input.dueDate !== undefined) {
      fields.push("due_date = ?");
      values.push(input.dueDate);
    }

    if (fields.length > 0) {
      values.push(id);
      await this.pool.execute(
        `UPDATE hrms_project_tasks SET ${fields.join(", ")} WHERE id = ?`,
        values,
      );
    }

    const [rows] = await this.pool.execute<TaskRow[]>(
      `SELECT t.*, a.full_name AS added_by_name
         FROM hrms_project_tasks t
         LEFT JOIN hrms_employees a ON a.id = t.added_by
        WHERE t.id = ?`,
      [id],
    );

    if (!rows.length) throw new Error("Task not found after update");
    const row = rows[0];

    return {
      id: row.id,
      projectId: row.project_id,
      parentTaskId: row.parent_task_id,
      title: row.title,
      status: row.status,
      note: row.note,
      dueDate: row.due_date ? String(row.due_date).slice(0, 10) : null,
      addedBy: row.added_by,
      addedByName: row.added_by_name,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      subtasks: [],
    };
  }

  async deleteTask(id: number): Promise<void> {
    // Delete subtasks first, then parent
    await this.pool.execute(`DELETE FROM hrms_project_tasks WHERE parent_task_id = ?`, [id]);
    await this.pool.execute(`DELETE FROM hrms_project_tasks WHERE id = ?`, [id]);
  }

  async findProjectOwner(id: number): Promise<{ employeeId: number; addedBy: number } | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT employee_id, added_by FROM hrms_employee_projects WHERE id = ?`,
      [id],
    );
    if (!rows.length) return null;
    return { employeeId: rows[0].employee_id, addedBy: rows[0].added_by };
  }

  async findTaskOwner(
    taskId: number,
  ): Promise<{ projectId: number; employeeId: number; addedBy: number } | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT t.project_id, p.employee_id, t.added_by
         FROM hrms_project_tasks t
         JOIN hrms_employee_projects p ON p.id = t.project_id
        WHERE t.id = ?`,
      [taskId],
    );
    if (!rows.length) return null;
    return {
      projectId: rows[0].project_id,
      employeeId: rows[0].employee_id,
      addedBy: rows[0].added_by,
    };
  }
}
