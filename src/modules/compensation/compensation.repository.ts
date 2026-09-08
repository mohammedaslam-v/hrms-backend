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

export class CompensationRepository implements ICompensationRepository {
  constructor(private readonly pool: Pool) {}

  async findHistory(employeeId: number): Promise<CompensationRecord[]> {
    const [rows] = await this.pool.execute<CompensationRow[]>(
      `SELECT id, employee_id, effective_from, ctc, variable_pay, bonus,
              esop_units, esop_vested_pct, revision_note, created_at
         FROM hrms_employee_compensation
        WHERE employee_id = ?
        ORDER BY effective_from DESC`,
      [employeeId],
    );

    return rows.map((row) => ({
      id: row.id,
      employeeId: row.employee_id,
      effectiveFrom: row.effective_from,
      // BIGINT columns arrive as numbers here because the values are whole
      // rupees well inside the safe integer range.
      ctc: Number(row.ctc),
      variablePay: Number(row.variable_pay),
      bonus: Number(row.bonus),
      esopUnits: Number(row.esop_units),
      // DECIMAL arrives as a string from the driver.
      esopVestedPct: Number(row.esop_vested_pct),
      revisionNote: row.revision_note,
      createdAt: row.created_at,
    }));
  }
}
