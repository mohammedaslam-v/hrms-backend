/**
 * Compensation — pure functions, no database.
 *
 * The only rule here is which revision applies, and it is worth stating
 * precisely because getting it wrong shows somebody a raise before they have
 * been told about it.
 */

import { CompensationFigures, CompensationRecord } from './compensation.model';
import type { SalaryComponents } from '../salary/salary.domain';
import type { IFieldCipher } from '../../shared/field-cipher';

/**
 * The revision in force on `onDate`: the most recent one that has already
 * taken effect.
 *
 * A row dated in the future is a revision that has been agreed but not yet
 * started. It must not be shown — an April raise entered in February is
 * confidential until April, and payroll would pay the wrong figure for two
 * months if it leaked early. "Latest row" is the wrong rule; "latest row that
 * has started" is the right one.
 *
 * Returns null when the employee has no compensation on record at all, which is
 * a real answer rather than an error: most records are not loaded yet.
 */
export function compensationOn(
  history: CompensationRecord[],
  onDate: string,
): CompensationRecord | null {
  let current: CompensationRecord | null = null;

  for (const revision of history) {
    if (revision.effectiveFrom > onDate) continue;
    if (!current || revision.effectiveFrom > current.effectiveFrom) current = revision;
  }

  return current;
}

/**
 * Units the employee actually holds today, as opposed to the units granted.
 * Rounded to whole units — a fraction of a share is not a thing anybody owns.
 */
export const vestedUnits = (record: CompensationRecord): number =>
  Math.round((record.esopUnits * record.esopVestedPct) / 100);

/**
 * What the encrypted `payload_enc` is bound to. It names the employee, so a
 * payload copied onto someone else's row fails to decrypt instead of giving
 * them a colleague's salary. Every reader and writer of the table uses this one
 * function, so they cannot disagree about it.
 */
export const compensationCipherContext = (employeeId: number): string =>
  `hrms_employee_compensation:${employeeId}`;

/**
 * The figures as the JSON that gets encrypted. Every amount, the note and the
 * breakup go in one blob: one decrypt per row, and a new pay field later needs
 * no new column.
 */
export const figuresToJson = (f: CompensationFigures): string =>
  JSON.stringify({
    ctc: f.ctc,
    variablePay: f.variablePay,
    bonus: f.bonus,
    esopUnits: f.esopUnits,
    esopVestedPct: f.esopVestedPct,
    revisionNote: f.revisionNote,
    components: f.components ?? null,
  });

const num = (value: unknown, field: string): number => {
  const n = Number(value);
  if (value === null || value === '' || !Number.isFinite(n)) {
    throw new Error(`Compensation payload: ${field} is not a number.`);
  }
  return n;
};

/**
 * The figures back from decrypted JSON. Strict about numbers: a salary that
 * comes back as NaN must stop the request, not be paid as zero.
 */
export function figuresFromJson(json: string): CompensationFigures {
  const raw = JSON.parse(json) as Record<string, unknown>;
  const c = raw.components as Record<string, unknown> | null | undefined;

  const components: SalaryComponents | null = c
    ? {
        basicM: num(c.basicM, 'basicM'),
        hraM: num(c.hraM ?? 0, 'hraM'),
        specialM: num(c.specialM ?? 0, 'specialM'),
        employerPfM: num(c.employerPfM ?? 0, 'employerPfM'),
        gratuityM: num(c.gratuityM ?? 0, 'gratuityM'),
        employeePfM: num(c.employeePfM ?? 0, 'employeePfM'),
        professionalTaxM: c.professionalTaxM == null ? null : num(c.professionalTaxM, 'professionalTaxM'),
      }
    : null;

  return {
    ctc: num(raw.ctc, 'ctc'),
    variablePay: num(raw.variablePay ?? 0, 'variablePay'),
    bonus: num(raw.bonus ?? 0, 'bonus'),
    esopUnits: num(raw.esopUnits ?? 0, 'esopUnits'),
    esopVestedPct: num(raw.esopVestedPct ?? 0, 'esopVestedPct'),
    revisionNote: typeof raw.revisionNote === 'string' ? raw.revisionNote : null,
    components,
  };
}

/**
 * A compensation row as it comes from the driver: the encrypted payload, plus
 * the old plain columns that rows written before encryption still carry.
 */
export interface StoredCompensationColumns {
  employee_id: number;
  payload_enc?: string | null;
  ctc?: number | string | null;
  variable_pay?: number | string | null;
  bonus?: number | string | null;
  esop_units?: number | string | null;
  esop_vested_pct?: number | string | null;
  revision_note?: string | null;
  basic_monthly?: string | null;
  hra_monthly?: string | null;
  special_monthly?: string | null;
  employer_pf_monthly?: string | null;
  gratuity_monthly?: string | null;
  employee_pf_monthly?: string | null;
  professional_tax_monthly?: string | null;
}

/**
 * The figures from a row written before encryption.
 *
 * Transitional: once src/scripts/encrypt-existing-compensation.ts has run and
 * the plain columns are dropped, nothing reaches this.
 */
export function figuresFromPlainColumns(row: StoredCompensationColumns): CompensationFigures {
  if (row.ctc == null) {
    throw new Error(`Compensation row for employee ${row.employee_id} has neither payload_enc nor ctc.`);
  }
  return {
    ctc: num(row.ctc, 'ctc'),
    variablePay: num(row.variable_pay ?? 0, 'variable_pay'),
    bonus: num(row.bonus ?? 0, 'bonus'),
    esopUnits: num(row.esop_units ?? 0, 'esop_units'),
    esopVestedPct: num(row.esop_vested_pct ?? 0, 'esop_vested_pct'),
    revisionNote: row.revision_note ?? null,
    // Keyed on Basic: the form always saved the full set together.
    components:
      row.basic_monthly == null
        ? null
        : {
            basicM: num(row.basic_monthly, 'basic_monthly'),
            hraM: num(row.hra_monthly ?? 0, 'hra_monthly'),
            specialM: num(row.special_monthly ?? 0, 'special_monthly'),
            employerPfM: num(row.employer_pf_monthly ?? 0, 'employer_pf_monthly'),
            gratuityM: num(row.gratuity_monthly ?? 0, 'gratuity_monthly'),
            employeePfM: num(row.employee_pf_monthly ?? 0, 'employee_pf_monthly'),
            professionalTaxM:
              row.professional_tax_monthly == null
                ? null
                : num(row.professional_tax_monthly, 'professional_tax_monthly'),
          },
  };
}

/** The figures in a stored row, from whichever form the row is in. */
export const readFigures = (row: StoredCompensationColumns, cipher: IFieldCipher): CompensationFigures =>
  row.payload_enc
    ? figuresFromJson(cipher.decrypt(row.payload_enc, compensationCipherContext(row.employee_id)))
    : figuresFromPlainColumns(row);

/** The figures as the value to store in `payload_enc`. */
export const sealFigures = (
  employeeId: number,
  figures: CompensationFigures,
  cipher: IFieldCipher,
): string => cipher.encrypt(figuresToJson(figures), compensationCipherContext(employeeId));

/**
 * What a write does to the old plain columns: clears them, so a row that is
 * overwritten does not keep its previous salary readable beside the new
 * encrypted one. Shared by every INSERT … ON DUPLICATE KEY UPDATE on the table.
 */
export const CLEAR_PLAIN_COMPENSATION_SQL = `ctc = NULL, variable_pay = 0, bonus = 0, esop_units = 0,
         esop_vested_pct = 0, revision_note = NULL, basic_monthly = NULL, hra_monthly = NULL,
         special_monthly = NULL, employer_pf_monthly = NULL, gratuity_monthly = NULL,
         employee_pf_monthly = NULL, professional_tax_monthly = NULL`;
