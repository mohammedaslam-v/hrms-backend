import { Pool, RowDataPacket } from 'mysql2/promise';
import { IOrgRepository } from './org.repository.interface';
import { RosterMember, RosterScope, TeamMember } from './org.model';
import { WorkMode } from '../profile/profile.model';
import { REPORTING_TREE_CTE, reportingTreeParams } from './reporting-tree.sql';

interface TreeRow extends RowDataPacket {
  id: number;
  employee_code: string;
  full_name: string;
  designation: string | null;
}

interface RosterRow extends TreeRow {
  department: string | null;
  manager_name: string | null;
  work_mode: WorkMode;
  shift_start: string;
  shift_end: string;
  weekly_off: string | null;
  date_of_joining: string;
  date_of_leaving: string | null;
}

const stillHere = (includeLeavers: boolean, hasDeleted: boolean): string => {
  const notDeleted = hasDeleted ? 'e.deleted_at IS NULL' : '1 = 1';
  const leavingClause = includeLeavers ? '1 = 1' : '(e.date_of_leaving IS NULL OR e.date_of_leaving >= CURDATE())';
  return `${notDeleted} AND ${leavingClause}`;
};

interface ExistsRow extends RowDataPacket {
  found: number;
}

export class OrgRepository implements IOrgRepository {
  private hasDeletedCol: boolean | null = null;

  constructor(private readonly pool: Pool) {}

  private async checkDeletedCol(): Promise<boolean> {
    if (this.hasDeletedCol !== null) return this.hasDeletedCol;
    try {
      const [rows] = await this.pool.query<RowDataPacket[]>(
        "SHOW COLUMNS FROM hrms_employees LIKE 'deleted_at'"
      );
      this.hasDeletedCol = rows.length > 0;
    } catch {
      this.hasDeletedCol = false;
    }
    return this.hasDeletedCol;
  }

  async findReportingTree(managerId: number, includeLeavers = false): Promise<TeamMember[]> {
    const hasDeleted = await this.checkDeletedCol();
    const [rows] = await this.pool.execute<TreeRow[]>(
      `${REPORTING_TREE_CTE}
       SELECT DISTINCT e.id, e.employee_code, e.full_name, e.designation
         FROM hrms_employees e
         JOIN tree ON tree.id = e.id
        WHERE ${stillHere(includeLeavers, hasDeleted)}
        ORDER BY e.full_name`,
      reportingTreeParams(managerId),
    );

    return rows.map((row) => ({
      id: row.id,
      employeeCode: row.employee_code,
      fullName: row.full_name,
      designation: row.designation,
    }));
  }

  async findRoster(scope: RosterScope): Promise<RosterMember[]> {
    const includeLeavers = scope.includeLeavers ?? false;
    const hasDeleted = await this.checkDeletedCol();

    const columns = `e.id, e.employee_code, e.full_name, e.designation, e.department,
              m.full_name AS manager_name,
              e.work_mode, e.shift_start, e.shift_end, e.weekly_off,
              e.date_of_joining, e.date_of_leaving`;

    const [rows] = scope.rootId === null
      ? await this.pool.execute<RosterRow[]>(
          `SELECT ${columns}
             FROM hrms_employees e
             LEFT JOIN hrms_employees m ON m.id = e.manager_id
            WHERE ${stillHere(includeLeavers, hasDeleted)}
            ORDER BY e.full_name`,
        )
      : await this.pool.execute<RosterRow[]>(
          `${REPORTING_TREE_CTE}
           SELECT DISTINCT ${columns}
             FROM hrms_employees e
             JOIN tree ON tree.id = e.id
             LEFT JOIN hrms_employees m ON m.id = e.manager_id
            WHERE ${stillHere(includeLeavers, hasDeleted)}
            ORDER BY e.full_name`,
          reportingTreeParams(scope.rootId),
        );

    return rows.map((row) => ({
      id: row.id,
      employeeCode: row.employee_code,
      fullName: row.full_name,
      designation: row.designation,
      department: row.department,
      managerName: row.manager_name,
      workMode: row.work_mode,
      shiftStart: row.shift_start.slice(0, 5),
      shiftEnd: row.shift_end.slice(0, 5),
      weeklyOff: row.weekly_off ? row.weekly_off.split(',').filter(Boolean) : [],
      dateOfJoining: row.date_of_joining,
      dateOfLeaving: row.date_of_leaving,
    }));
  }

  async isInReportingTree(managerId: number, employeeId: number): Promise<boolean> {
    const [rows] = await this.pool.execute<ExistsRow[]>(
      `${REPORTING_TREE_CTE}
       SELECT 1 AS found FROM tree WHERE tree.id = ? LIMIT 1`,
      [...reportingTreeParams(managerId), employeeId],
    );
    return rows.length > 0;
  }
}
