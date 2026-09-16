import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { GoalDirection, GoalPeriod, GoalRecord, GoalType } from './goals.domain';
import { IGoalsRepository } from './goals.repository.interface';
import { CreateGoalDto } from './goals.model';

interface GoalRow extends RowDataPacket {
  id: number;
  ref: string;
  employee_id: number;
  title: string;
  goal_type: GoalType;
  fy: string;
  period: GoalPeriod;
  target_value: string | null;
  current_value: string | null;
  unit: string | null;
  direction: GoalDirection;
  note: string | null;
  set_on: string | Date;
  set_by: number | null;
  setter_name: string | null;
  milestone_id: number | null;
  milestone_title: string | null;
  milestone_done: number | null;
  milestone_order: number | null;
}

const fmtDate = (d: string | Date | null | undefined): string => {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
};

export class GoalsRepository implements IGoalsRepository {
  constructor(private readonly pool: Pool) {}

  async findForEmployee(employeeId: number, fy: string): Promise<GoalRecord[]> {
    const [rows] = await this.pool.execute<GoalRow[]>(
      `SELECT g.id, g.ref, g.employee_id, g.title, g.goal_type, g.fy, g.period,
              g.target_value, g.current_value, g.unit, g.direction, g.note,
              g.set_on, g.set_by, s.full_name AS setter_name,
              m.id         AS milestone_id,
              m.title      AS milestone_title,
              m.is_done    AS milestone_done,
              m.sort_order AS milestone_order
         FROM hrms_goals g
         LEFT JOIN hrms_employees s ON s.id = g.set_by
         LEFT JOIN hrms_goal_milestones m ON m.goal_id = g.id
        WHERE g.employee_id = ? AND g.fy = ?
        ORDER BY g.period, g.set_on DESC, g.id, m.sort_order, m.id`,
      [employeeId, fy],
    );

    return this.rowsToRecords(rows);
  }

  async findForEmployees(employeeIds: number[], fy: string): Promise<Map<number, GoalRecord[]>> {
    const result = new Map<number, GoalRecord[]>();
    for (const id of employeeIds) {
      result.set(id, []);
    }
    if (employeeIds.length === 0) return result;

    const [rows] = await this.pool.query<GoalRow[]>(
      `SELECT g.id, g.ref, g.employee_id, g.title, g.goal_type, g.fy, g.period,
              g.target_value, g.current_value, g.unit, g.direction, g.note,
              g.set_on, g.set_by, s.full_name AS setter_name,
              m.id         AS milestone_id,
              m.title      AS milestone_title,
              m.is_done    AS milestone_done,
              m.sort_order AS milestone_order
         FROM hrms_goals g
         LEFT JOIN hrms_employees s ON s.id = g.set_by
         LEFT JOIN hrms_goal_milestones m ON m.goal_id = g.id
        WHERE g.employee_id IN (?) AND g.fy = ?
        ORDER BY g.employee_id, g.period, g.set_on DESC, g.id, m.sort_order, m.id`,
      [employeeIds, fy],
    );

    const records = this.rowsToRecords(rows);
    for (const rec of records) {
      const list = result.get(rec.employeeId);
      if (list) {
        list.push(rec);
      } else {
        result.set(rec.employeeId, [rec]);
      }
    }

    return result;
  }

  async findById(id: number): Promise<GoalRecord | null> {
    const [rows] = await this.pool.execute<GoalRow[]>(
      `SELECT g.id, g.ref, g.employee_id, g.title, g.goal_type, g.fy, g.period,
              g.target_value, g.current_value, g.unit, g.direction, g.note,
              g.set_on, g.set_by, s.full_name AS setter_name,
              m.id         AS milestone_id,
              m.title      AS milestone_title,
              m.is_done    AS milestone_done,
              m.sort_order AS milestone_order
         FROM hrms_goals g
         LEFT JOIN hrms_employees s ON s.id = g.set_by
         LEFT JOIN hrms_goal_milestones m ON m.goal_id = g.id
        WHERE g.id = ?
        ORDER BY m.sort_order, m.id`,
      [id],
    );

    const records = this.rowsToRecords(rows);
    return records[0] ?? null;
  }

  async create(
    dto: CreateGoalDto,
    fy: string,
    setBy: number | null,
    setOn: string,
  ): Promise<GoalRecord> {
    const [res] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO hrms_goals (
         ref, employee_id, title, goal_type, fy, period,
         target_value, current_value, unit, direction, note, set_by, set_on
       ) VALUES ('', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        dto.employeeId,
        dto.title.trim(),
        dto.goalType,
        fy,
        dto.period,
        dto.goalType === 'metric' ? (dto.targetValue ?? null) : null,
        dto.goalType === 'metric' ? (dto.currentValue ?? 0) : 0,
        dto.goalType === 'metric' ? (dto.unit ?? null) : null,
        dto.goalType === 'metric' ? (dto.direction ?? 'up') : 'up',
        dto.note?.trim() || null,
        setBy,
        setOn,
      ],
    );

    const insertId = res.insertId;
    await this.pool.execute(
      `UPDATE hrms_goals SET ref = CONCAT('GL-', LPAD(id, 4, '0')) WHERE id = ?`,
      [insertId],
    );

    if (dto.goalType === 'milestone' && dto.milestones && dto.milestones.length > 0) {
      for (let i = 0; i < dto.milestones.length; i++) {
        const mTitle = dto.milestones[i].trim();
        if (!mTitle) continue;
        await this.pool.execute(
          `INSERT INTO hrms_goal_milestones (goal_id, title, is_done, sort_order)
           VALUES (?, ?, 0, ?)`,
          [insertId, mTitle, i],
        );
      }
    }

    const created = await this.findById(insertId);
    if (!created) throw new Error(`Goal ${insertId} not found after creation`);
    return created;
  }

  async updateMetric(id: number, currentValue: number): Promise<void> {
    await this.pool.execute(
      `UPDATE hrms_goals SET current_value = ? WHERE id = ?`,
      [currentValue, id],
    );
  }

  async toggleMilestone(
    milestoneId: number,
    isDone: boolean,
    doneBy: number,
  ): Promise<void> {
    const doneNum = isDone ? 1 : 0;
    await this.pool.execute(
      `UPDATE hrms_goal_milestones
          SET is_done = ?,
              done_at = IF(? = 1, NOW(), NULL),
              done_by = IF(? = 1, ?, NULL)
        WHERE id = ?`,
      [doneNum, doneNum, doneNum, doneBy, milestoneId],
    );
  }

  async delete(id: number): Promise<void> {
    await this.pool.execute(`DELETE FROM hrms_goals WHERE id = ?`, [id]);
  }

  private rowsToRecords(rows: GoalRow[]): GoalRecord[] {
    const goals: GoalRecord[] = [];
    const byId = new Map<number, GoalRecord>();

    for (const row of rows) {
      let goal = byId.get(row.id);
      if (!goal) {
        goal = {
          id: row.id,
          ref: row.ref,
          employeeId: row.employee_id,
          title: row.title,
          goalType: row.goal_type,
          fy: row.fy,
          period: row.period,
          targetValue: row.target_value === null ? null : Number(row.target_value),
          currentValue: row.current_value === null ? null : Number(row.current_value),
          unit: row.unit,
          direction: row.direction,
          note: row.note,
          setOn: fmtDate(row.set_on),
          setBy: row.set_by,
          setterName: row.setter_name ?? (row.set_by ? null : 'Board'),
          milestones: [],
        };
        byId.set(row.id, goal);
        goals.push(goal);
      }

      if (row.milestone_id !== null) {
        goal.milestones.push({
          id: row.milestone_id,
          title: row.milestone_title ?? '',
          isDone: row.milestone_done === 1,
          sortOrder: row.milestone_order ?? 0,
        });
      }
    }

    return goals;
  }
}
