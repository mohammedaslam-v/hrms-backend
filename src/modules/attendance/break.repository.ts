import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { BreakRecord } from './break.domain';
import type { ZoneKind } from './geofence.domain';
import { EndBreakInput, IBreakRepository, StartBreakInput } from './break.repository.interface';

interface BreakRow extends RowDataPacket {
  id: number;
  work_date: string;
  started_at: string;
  ended_at: string | null;
  ends_by: string;
  start_device: string;
  start_device_label: string | null;
  start_zone: ZoneKind | null;
}

// DATETIMEs come back as 'YYYY-MM-DD HH:MM:SS' (dateStrings), trimmed to minutes.
const COLUMNS = `id, DATE_FORMAT(work_date, '%Y-%m-%d') AS work_date,
  DATE_FORMAT(started_at, '%Y-%m-%d %H:%i') AS started_at,
  DATE_FORMAT(ended_at, '%Y-%m-%d %H:%i') AS ended_at,
  DATE_FORMAT(ends_by, '%Y-%m-%d %H:%i') AS ends_by,
  start_device, start_device_label, start_zone`;

const toRecord = (r: BreakRow): BreakRecord => ({
  id: Number(r.id),
  startedAt: r.started_at,
  endedAt: r.ended_at,
  endsBy: r.ends_by,
  startDevice: r.start_device,
  startDeviceLabel: r.start_device_label,
  startZone: r.start_zone,
});

export class BreakRepository implements IBreakRepository {
  constructor(private readonly pool: Pool) {}

  async findForShift(employeeId: number, workDate: string): Promise<BreakRecord[]> {
    const [rows] = await this.pool.execute<BreakRow[]>(
      `SELECT ${COLUMNS} FROM hrms_attendance_breaks
        WHERE employee_id = ? AND work_date = ?
        ORDER BY started_at ASC`,
      [employeeId, workDate],
    );
    return rows.map(toRecord);
  }

  async findOpen(employeeId: number): Promise<(BreakRecord & { workDate: string }) | null> {
    const [rows] = await this.pool.execute<BreakRow[]>(
      `SELECT ${COLUMNS} FROM hrms_attendance_breaks
        WHERE employee_id = ? AND ended_at IS NULL
        LIMIT 1`,
      [employeeId],
    );
    return rows[0] ? { ...toRecord(rows[0]), workDate: rows[0].work_date } : null;
  }

  async start(input: StartBreakInput): Promise<number | null> {
    try {
      const [result] = await this.pool.execute<ResultSetHeader>(
        `INSERT INTO hrms_attendance_breaks
           (employee_id, attendance_id, work_date, started_at, ends_by,
            start_device, start_device_label, start_zone)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.employeeId,
          input.attendanceId,
          input.workDate,
          `${input.startedAt}:00`,
          `${input.endsBy}:00`,
          input.device,
          input.deviceLabel,
          input.zone,
        ],
      );
      return result.insertId;
    } catch (err) {
      // uq_one_open_break: a second tab started one a moment earlier.
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') return null;
      throw err;
    }
  }

  async end(input: EndBreakInput): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE hrms_attendance_breaks
          SET ended_at = ?, end_reason = ?, end_device = ?, end_zone = ?
        WHERE id = ? AND ended_at IS NULL`,
      [`${input.endedAt}:00`, input.reason, input.device, input.zone, input.id],
    );
    return result.affectedRows > 0;
  }
}
