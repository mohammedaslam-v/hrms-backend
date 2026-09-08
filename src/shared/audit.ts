import { Pool } from 'mysql2/promise';

/**
 * Writes one row of `hrms_audit_log`.
 *
 * Shared rather than copied: every module that changes something people care
 * about writes here, and one writer means the columns can never be filled
 * inconsistently — an audit trail with two shapes is worse than none.
 */
export async function recordAudit(
  pool: Pool,
  entry: {
    actorEmployeeId: number;
    action: string;
    entityType: string;
    entityId: number | null;
    before: unknown;
    after: unknown;
  },
): Promise<void> {
  await pool.execute(
    `INSERT INTO hrms_audit_log
       (actor_employee_id, action, entity_type, entity_id, before_json, after_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      entry.actorEmployeeId,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.before === null || entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === null || entry.after === undefined ? null : JSON.stringify(entry.after),
    ],
  );
}
