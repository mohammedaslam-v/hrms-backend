/**
 * Encrypts the salary rows written before encryption existed.
 *
 * Every row whose payload_enc is empty gets its plain figures sealed into
 * payload_enc. The plain columns are left alone here — they are dropped once
 * the encrypted copies are confirmed — so this step can be undone by simply
 * clearing payload_enc again.
 *
 * Needs the payload_enc and is_placeholder columns on the table first (added
 * by hand with ALTER TABLE), and the SAME COMPENSATION_ENC_KEY the backend
 * for that database uses. Encrypting live rows with the dev key would leave
 * them unreadable by the live server.
 *
 * Usage (from hrms-backend/):
 *   npx tsx src/scripts/encrypt-existing-compensation.ts
 *       dry run: connects, lists what it would encrypt, writes nothing
 *   npx tsx src/scripts/encrypt-existing-compensation.ts --apply --confirm-db=<DB_NAME>
 *       writes; --confirm-db must name the database it is connected to
 *
 * Built into the image as dist/scripts/encrypt-existing-compensation.js, so on
 * live it can run as a one-off Cloud Run job with the service's own env —
 * the live key never has to leave Google Cloud.
 *
 * Prints employee ids and dates only, never amounts.
 */
import { isDeepStrictEqual } from 'node:util';
import { RowDataPacket } from 'mysql2/promise';
import { env } from '../config/env';
import { closePool, getPool } from '../config/database';
import { FieldCipher } from '../shared/field-cipher';
import {
  figuresFromPlainColumns,
  readFigures,
  sealFigures,
  StoredCompensationColumns,
} from '../modules/compensation/compensation.domain';

interface Row extends RowDataPacket, StoredCompensationColumns {
  id: number;
  employee_id: number;
  effective_from: string;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const confirmDb = args.find((a) => a.startsWith('--confirm-db='))?.split('=')[1];

  const target = `${env.db.host}:${env.db.port}/${env.db.name}`;
  console.log(`Database: ${target}`);
  console.log(apply ? 'Mode: APPLY (will write)' : 'Mode: dry run (writes nothing)');

  if (apply && confirmDb !== env.db.name) {
    throw new Error(
      `Refusing to write: pass --confirm-db=${env.db.name} to confirm this is the database you mean.`,
    );
  }

  const cipher = new FieldCipher(
    { v1: FieldCipher.keyFromBase64('COMPENSATION_ENC_KEY', env.compensationEncKey) },
    'v1',
  );
  const pool = getPool();

  try {
    const [rows] = await pool.query<Row[]>(
      `SELECT id, employee_id, effective_from, payload_enc,
              ctc, variable_pay, bonus, esop_units, esop_vested_pct, revision_note,
              basic_monthly, hra_monthly, special_monthly, employer_pf_monthly,
              gratuity_monthly, employee_pf_monthly, professional_tax_monthly
         FROM hrms_employee_compensation
        WHERE payload_enc IS NULL
        ORDER BY employee_id, effective_from`,
    );

    console.log(`Rows to encrypt: ${rows.length}`);

    // Seal and verify every row before writing any of them: a row that cannot
    // be read back stops the run with nothing changed.
    const sealed = rows.map((row) => {
      const figures = figuresFromPlainColumns(row);
      const payload = sealFigures(row.employee_id, figures, cipher);
      const back = readFigures({ employee_id: row.employee_id, payload_enc: payload }, cipher);
      if (!isDeepStrictEqual(back, figures)) {
        throw new Error(`Row ${row.id} did not read back identically. Nothing was written.`);
      }
      console.log(`  row ${row.id}  employee ${row.employee_id}  from ${row.effective_from}  ok`);
      return { id: row.id, payload };
    });

    if (!apply) {
      console.log('Dry run finished. Re-run with --apply --confirm-db=<name> to write.');
      return;
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      let written = 0;
      for (const { id, payload } of sealed) {
        // `payload_enc IS NULL` again, so a row the new backend saved after the
        // SELECT above is not overwritten with its older plain figures.
        const [result] = await connection.execute(
          `UPDATE hrms_employee_compensation SET payload_enc = ? WHERE id = ? AND payload_enc IS NULL`,
          [payload, id],
        );
        written += (result as { affectedRows: number }).affectedRows;
      }
      await connection.commit();
      console.log(`Encrypted ${written} of ${sealed.length} rows.`);
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    const [[after]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total_rows, SUM(payload_enc IS NULL) AS still_plain
         FROM hrms_employee_compensation`,
    );
    console.log(`Now: ${after.total_rows} rows, ${Number(after.still_plain)} without payload_enc.`);
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
