import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ICompensationRepository } from './compensation.repository.interface';
import { CompensationFigures, CompensationRecord } from './compensation.model';
import {
  CLEAR_PLAIN_COMPENSATION_SQL,
  readFigures,
  sealFigures,
  StoredCompensationColumns,
} from './compensation.domain';
import { IFieldCipher } from '../../shared/field-cipher';
import { recordAudit } from '../../shared/audit';

interface CompensationRow extends RowDataPacket, StoredCompensationColumns {
  id: number;
  employee_id: number;
  effective_from: string;
  is_placeholder: number;
  created_at: string;
}

/**
 * The plain columns are still selected because rows written before encryption
 * only have those. Rows written since have them cleared and carry payload_enc;
 * readFigures() picks whichever the row has.
 */
const COLUMNS = `id, employee_id, effective_from, payload_enc, is_placeholder, created_at,
  ctc, variable_pay, bonus, esop_units, esop_vested_pct, revision_note,
  basic_monthly, hra_monthly, special_monthly, employer_pf_monthly,
  gratuity_monthly, employee_pf_monthly, professional_tax_monthly`;

/**
 * Salary figures are encrypted in `payload_enc` (see shared/field-cipher.ts).
 * Only this repository, the Add employee insert and the reports repository
 * touch the table, and all three go through readFigures()/sealFigures(), so
 * nothing above the repository layer knows the figures were ever encrypted.
 */
export class CompensationRepository implements ICompensationRepository {
  constructor(
    private readonly pool: Pool,
    private readonly cipher: IFieldCipher,
  ) {}

  private mapRecord(row: CompensationRow): CompensationRecord {
    return {
      id: row.id,
      employeeId: row.employee_id,
      effectiveFrom: row.effective_from,
      ...readFigures(row, this.cipher),
      isPlaceholder: Boolean(row.is_placeholder),
      createdAt: row.created_at,
    };
  }

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
      const record = this.mapRecord(row);
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
    return rows.map((row) => this.mapRecord(row));
  }

  async addRevision(
    record: Omit<CompensationRecord, 'id' | 'createdAt'>,
    createdBy: number,
  ): Promise<CompensationRecord> {
    // The edit form does not send the monthly breakup. Saving over an existing
    // revision keeps the breakup that row already had — the behaviour before
    // encryption, when the update simply left those columns alone.
    let components = record.components;
    if (components === undefined) {
      const [existing] = await this.pool.execute<CompensationRow[]>(
        `SELECT ${COLUMNS}
           FROM hrms_employee_compensation
          WHERE employee_id = ? AND effective_from = ?`,
        [record.employeeId, record.effectiveFrom],
      );
      components = existing[0] ? readFigures(existing[0], this.cipher).components : null;
    }

    const figures: CompensationFigures = {
      ctc: record.ctc,
      variablePay: record.variablePay ?? 0,
      bonus: record.bonus ?? 0,
      esopUnits: record.esopUnits ?? 0,
      esopVestedPct: record.esopVestedPct ?? 0,
      revisionNote: record.revisionNote ?? null,
      components,
    };
    const isPlaceholder = record.isPlaceholder ?? false;

    // `id = LAST_INSERT_ID(id)` makes insertId the existing row's id when the
    // date already had a revision, so the audit line names the right row.
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO hrms_employee_compensation
         (employee_id, effective_from, payload_enc, is_placeholder, created_by)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         id = LAST_INSERT_ID(id),
         payload_enc = VALUES(payload_enc),
         is_placeholder = VALUES(is_placeholder),
         created_by = VALUES(created_by),
         ${CLEAR_PLAIN_COMPENSATION_SQL}`,
      [
        record.employeeId,
        record.effectiveFrom,
        sealFigures(record.employeeId, figures, this.cipher),
        isPlaceholder ? 1 : 0,
        createdBy,
      ],
    );

    // Who changed whose pay, and when — never the amounts, or the audit log
    // would become a second, unencrypted copy of every salary.
    await recordAudit(this.pool, {
      actorEmployeeId: createdBy,
      action: 'compensation.revised',
      entityType: 'hrms_employee_compensation',
      entityId: result.insertId || null,
      before: null,
      after: { employeeId: record.employeeId, effectiveFrom: record.effectiveFrom, isPlaceholder },
    });

    return {
      id: result.insertId,
      employeeId: record.employeeId,
      effectiveFrom: record.effectiveFrom,
      ...figures,
      isPlaceholder,
      createdAt: new Date().toISOString(),
    };
  }
}
