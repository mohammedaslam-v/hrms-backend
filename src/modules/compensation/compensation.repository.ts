import { Pool, RowDataPacket } from 'mysql2/promise';
import { ICompensationRepository } from './compensation.repository.interface';
import { CompensationRecord } from './compensation.model';

interface CompensationRow extends RowDataPacket {
  id: number;
  employee_id: number;
  effective_from: string;
  ctc: number;
  variable_pay: number;
  bonus: number;
  esop_units: number;
  esop_vested_pct: string;
  revision_note: string | null;
  created_at: string;
}

const COLUMNS = `id, employee_id, effective_from, ctc, variable_pay, bonus,
  esop_units, esop_vested_pct, revision_note, created_at`;

const mapRecord = (row: CompensationRow): CompensationRecord => ({
  id: row.id,
  employeeId: row.employee_id,
  effectiveFrom: row.effective_from,
  // BIGINT columns arrive as numbers: whole rupees, well inside the safe range.
  ctc: Number(row.ctc),
  variablePay: Number(row.variable_pay),
  bonus: Number(row.bonus),
  esopUnits: Number(row.esop_units),
  // DECIMAL arrives as a string from the driver.
  esopVestedPct: Number(row.esop_vested_pct),
  revisionNote: row.revision_note,
  createdAt: row.created_at,
});

export class CompensationRepository implements ICompensationRepository {
  constructor(private readonly pool: Pool) {}

  async findHistoryForMany(employeeIds: number[]): Promise<Map<number, CompensationRecord[]>> {
    const byEmployee = new Map<number, CompensationRecord[]>();
    if (employeeIds.length === 0) return byEmployee;

    const placeholders = employeeIds.map(() => '?').join(',');
    const [rows] = await this.pool.query<CompensationRow[]>(
      `SELECT ${COLUMNS}
         FROM hrms_employee_compensation
        WHERE employee_id IN (${placeholders})
        ORDER BY employee_id, effective_from DESC`,
      employeeIds,
    );

    for (const row of rows) {
      const record = mapRecord(row);
      const list = byEmployee.get(record.employeeId);
      if (list) list.push(record);
      else byEmployee.set(record.employeeId, [record]);
    }
    return byEmployee;
  }

  async findHistory(employeeId: number): Promise<CompensationRecord[]> {
    const [rows] = await this.pool.execute<CompensationRow[]>(
      `SELECT ${COLUMNS}
         FROM hrms_employee_compensation
        WHERE employee_id = ?
        ORDER BY effective_from DESC`,
      [employeeId],
    );
    return rows.map(mapRecord);
  }
}
