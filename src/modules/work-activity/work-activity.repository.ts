import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { CreateWorkActivityDto, WorkActivity, WorkActivityType } from './work-activity.model';
import { IWorkActivityRepository } from './work-activity.repository.interface';

const COLUMNS = `id, employee_id,
  DATE_FORMAT(activity_date, '%Y-%m-%d') AS activity_date,
  activity_type,
  DATE_FORMAT(start_time, '%H:%i') AS start_time,
  DATE_FORMAT(end_time, '%H:%i')   AS end_time,
  note,
  DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS created_at`;

const toActivity = (r: RowDataPacket): WorkActivity => ({
  id: Number(r.id),
  employeeId: Number(r.employee_id),
  date: String(r.activity_date),
  type: r.activity_type as WorkActivityType,
  startTime: String(r.start_time),
  endTime: String(r.end_time),
  note: r.note == null ? null : String(r.note),
  createdAt: String(r.created_at),
});

export class WorkActivityRepository implements IWorkActivityRepository {
  constructor(private readonly pool: Pool) {}

  async findRange(employeeId: number, from: string, to: string): Promise<WorkActivity[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${COLUMNS}
         FROM hrms_work_activities
        WHERE employee_id = ? AND activity_date BETWEEN ? AND ? AND deleted_at IS NULL
        ORDER BY activity_date, start_time`,
      [employeeId, from, to],
    );
    return rows.map(toActivity);
  }

  async findRangeForMany(
    employeeIds: number[],
    from: string,
    to: string,
  ): Promise<Map<number, WorkActivity[]>> {
    const byEmployee = new Map<number, WorkActivity[]>();
    if (employeeIds.length === 0) return byEmployee;
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${COLUMNS}
         FROM hrms_work_activities
        WHERE employee_id IN (${employeeIds.map(() => '?').join(', ')})
          AND activity_date BETWEEN ? AND ? AND deleted_at IS NULL
        ORDER BY activity_date, start_time`,
      [...employeeIds, from, to],
    );
    for (const activity of rows.map(toActivity)) {
      const list = byEmployee.get(activity.employeeId) ?? [];
      list.push(activity);
      byEmployee.set(activity.employeeId, list);
    }
    return byEmployee;
  }

  async findById(id: number): Promise<WorkActivity | null> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${COLUMNS} FROM hrms_work_activities WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? toActivity(rows[0]) : null;
  }

  async create(employeeId: number, dto: CreateWorkActivityDto, createdBy: number): Promise<WorkActivity> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO hrms_work_activities
         (employee_id, activity_date, activity_type, start_time, end_time, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [employeeId, dto.date, dto.type, dto.startTime, dto.endTime, dto.note, createdBy],
    );
    const created = await this.findById(result.insertId);
    if (!created) throw new Error('Activity was saved but could not be read back.');
    return created;
  }

  async softDelete(id: number, deletedBy: number): Promise<void> {
    await this.pool.execute(
      `UPDATE hrms_work_activities SET deleted_at = NOW(), deleted_by = ? WHERE id = ? AND deleted_at IS NULL`,
      [deletedBy, id],
    );
  }
}
