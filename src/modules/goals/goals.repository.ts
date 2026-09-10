import { Pool, RowDataPacket } from 'mysql2/promise';
import { GoalDirection, GoalPeriod, GoalRecord, GoalType } from './goals.domain';
import { IGoalsRepository } from './goals.repository.interface';

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
  milestone_id: number | null;
  milestone_title: string | null;
  milestone_done: number | null;
  milestone_order: number | null;
}

export class GoalsRepository implements IGoalsRepository {
  constructor(private readonly pool: Pool) {}

  async findForEmployee(employeeId: number, fy: string): Promise<GoalRecord[]> {
    // A LEFT JOIN, so a goal with no milestones still comes back — a metric goal
    // has none by definition, and an INNER JOIN would silently drop every one.
    //
    // The join repeats the goal columns once per milestone; they are grouped
    // below. That is cheaper than a second query for a handful of rows, and the
    // ORDER BY makes the grouping a single pass.
    const [rows] = await this.pool.execute<GoalRow[]>(
      `SELECT g.id, g.ref, g.employee_id, g.title, g.goal_type, g.fy, g.period,
              g.target_value, g.current_value, g.unit, g.direction, g.note,
              m.id         AS milestone_id,
              m.title      AS milestone_title,
              m.is_done    AS milestone_done,
              m.sort_order AS milestone_order
         FROM hrms_goals g
         LEFT JOIN hrms_goal_milestones m ON m.goal_id = g.id
        WHERE g.employee_id = ? AND g.fy = ?
        ORDER BY g.period, g.set_on DESC, g.id, m.sort_order, m.id`,
      [employeeId, fy],
    );

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
          // DECIMAL arrives as a string from the driver; null stays null so
          // "no target set" is distinguishable from a target of zero.
          targetValue: row.target_value === null ? null : Number(row.target_value),
          currentValue: row.current_value === null ? null : Number(row.current_value),
          unit: row.unit,
          direction: row.direction,
          note: row.note,
          milestones: [],
        };
        byId.set(row.id, goal);
        // Pushed on first sight, so the ORDER BY above decides the final order.
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
