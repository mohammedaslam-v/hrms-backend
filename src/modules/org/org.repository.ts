import { Pool, RowDataPacket } from 'mysql2/promise';
import { IOrgRepository } from './org.repository.interface';
import { TeamMember } from './org.model';
import { REPORTING_TREE_CTE, reportingTreeParams } from './reporting-tree.sql';

interface TreeRow extends RowDataPacket {
  id: number;
  employee_code: string;
  full_name: string;
  designation: string | null;
}

interface ExistsRow extends RowDataPacket {
  found: number;
}

export class OrgRepository implements IOrgRepository {
  constructor(private readonly pool: Pool) {}

  async findReportingTree(managerId: number): Promise<TeamMember[]> {
    const [rows] = await this.pool.execute<TreeRow[]>(
      `${REPORTING_TREE_CTE}
       SELECT DISTINCT e.id, e.employee_code, e.full_name, e.designation
         FROM hrms_employees e
         JOIN tree ON tree.id = e.id
        WHERE e.date_of_leaving IS NULL OR e.date_of_leaving >= CURDATE()
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

  async isInReportingTree(managerId: number, employeeId: number): Promise<boolean> {
    // `LIMIT 1` stops as soon as the person is found rather than expanding the
    // rest of the tree — a skip-level manager can have hundreds of reports, and
    // whether one particular person is among them is a single row of work.
    const [rows] = await this.pool.execute<ExistsRow[]>(
      `${REPORTING_TREE_CTE}
       SELECT 1 AS found FROM tree WHERE tree.id = ? LIMIT 1`,
      [...reportingTreeParams(managerId), employeeId],
    );
    return rows.length > 0;
  }
}
