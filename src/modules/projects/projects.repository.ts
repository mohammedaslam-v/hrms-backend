import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { AddProjectInput, ProjectRecord, ProjectStatus } from './projects.model';
import { IProjectsRepository } from './projects.repository.interface';

interface ProjectRow extends RowDataPacket {
  id: number;
  employee_id: number;
  title: string;
  status: ProjectStatus;
  note: string | null;
  started_on: string | null;
  added_by: number;
  added_by_name: string | null;
}

export class ProjectsRepository implements IProjectsRepository {
  constructor(private readonly pool: Pool) {}

  async add(input: AddProjectInput): Promise<ProjectRecord> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO hrms_employee_projects
         (employee_id, title, status, note, started_on, added_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [input.employeeId, input.title, input.status, input.note, input.startedOn, input.addedBy],
    );

    // Read back rather than echo the input: the row is what exists, and the
    // author's name has to be resolved anyway.
    const stored = (await this.findForEmployee(input.employeeId)).find(
      (p) => p.id === result.insertId,
    );
    if (!stored) throw new Error('Project was inserted but could not be read back');
    return stored;
  }

  async findForEmployee(employeeId: number): Promise<ProjectRecord[]> {
    // The author's name comes from the same statement — an entry nobody can
    // attribute is worth less than no entry, and a second query per row to find
    // out who added it is the N+1 this join exists to avoid.
    //
    // Ordering puts current work first: FIELD() ranks the enum by usefulness
    // rather than by its declaration order.
    const [rows] = await this.pool.execute<ProjectRow[]>(
      `SELECT p.id, p.employee_id, p.title, p.status, p.note, p.started_on,
              p.added_by, a.full_name AS added_by_name
         FROM hrms_employee_projects p
         LEFT JOIN hrms_employees a ON a.id = p.added_by
        WHERE p.employee_id = ?
        ORDER BY FIELD(p.status, 'Live', 'In progress', 'Done'),
                 p.started_on DESC, p.id DESC`,
      [employeeId],
    );

    return rows.map((row) => ({
      id: row.id,
      employeeId: row.employee_id,
      title: row.title,
      status: row.status,
      note: row.note,
      startedOn: row.started_on,
      addedBy: row.added_by,
      addedByName: row.added_by_name,
    }));
  }
}
