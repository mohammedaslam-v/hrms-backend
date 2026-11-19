import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import {
  compensationOn,
  figuresFromJson,
  readFigures,
  sealFigures,
  vestedUnits,
} from './compensation.domain';
import type { CompensationFigures, CompensationRecord } from './compensation.model';
import { FieldCipher } from '../../shared/field-cipher';

describe('stored compensation', () => {
  const cipher = new FieldCipher({ v1: crypto.randomBytes(32) }, 'v1');
  const figures: CompensationFigures = {
    ctc: 1_150_000,
    variablePay: 120_000,
    bonus: 50_000,
    esopUnits: 400,
    esopVestedPct: 25,
    revisionNote: 'FY26-27 revision',
    components: {
      basicM: 40_000,
      hraM: 20_000,
      specialM: 25_000,
      employerPfM: 1_800,
      gratuityM: 1_924,
      employeePfM: 1_800,
      professionalTaxM: null,
    },
  };

  it('reads back every figure it sealed, breakup included', () => {
    const row = { employee_id: 336, payload_enc: sealFigures(336, figures, cipher) };
    assert.deepEqual(readFigures(row, cipher), figures);
  });

  it('will not read one employee’s figures on another’s row', () => {
    const row = { employee_id: 337, payload_enc: sealFigures(336, figures, cipher) };
    assert.throws(() => readFigures(row, cipher));
  });

  it('still reads a row written before encryption', () => {
    const legacy = {
      employee_id: 336,
      payload_enc: null,
      ctc: 900000,
      variable_pay: 0,
      bonus: 0,
      esop_units: 0,
      esop_vested_pct: '0.00',
      revision_note: 'On joining',
      basic_monthly: null,
    };
    assert.deepEqual(readFigures(legacy, cipher), {
      ctc: 900_000,
      variablePay: 0,
      bonus: 0,
      esopUnits: 0,
      esopVestedPct: 0,
      revisionNote: 'On joining',
      components: null,
    });
  });

  it('refuses a payload whose salary is not a number, rather than paying zero', () => {
    assert.throws(() => figuresFromJson('{"ctc":null}'), /ctc/);
    assert.throws(() => figuresFromJson('{"ctc":"abc"}'), /ctc/);
  });

  it('refuses a row with no salary in either form', () => {
    assert.throws(() => readFigures({ employee_id: 1, payload_enc: null, ctc: null }, cipher));
  });
});

const revision = (over: Partial<CompensationRecord> = {}): CompensationRecord => ({
  id: 1,
  employeeId: 336,
  effectiveFrom: '2024-04-01',
  ctc: 900000,
  variablePay: 0,
  bonus: 0,
  esopUnits: 0,
  esopVestedPct: 0,
  revisionNote: null,
  createdAt: '2024-03-01 10:00:00',
  ...over,
});

describe('which revision applies', () => {
  it('picks the most recent one that has already started', () => {
    const history = [
      revision({ id: 3, effectiveFrom: '2026-04-01', ctc: 1_400_000 }),
      revision({ id: 2, effectiveFrom: '2025-04-01', ctc: 1_100_000 }),
      revision({ id: 1, effectiveFrom: '2024-04-01', ctc: 900_000 }),
    ];
    assert.equal(compensationOn(history, '2026-09-08')?.ctc, 1_400_000);
    assert.equal(compensationOn(history, '2025-06-01')?.ctc, 1_100_000);
    assert.equal(compensationOn(history, '2024-12-31')?.ctc, 900_000);
  });

  it('ignores a revision dated in the future', () => {
    // The rule that matters. An April raise entered in February is agreed but
    // confidential until April, and payroll would pay it two months early.
    const history = [
      revision({ id: 2, effectiveFrom: '2027-04-01', ctc: 1_800_000 }),
      revision({ id: 1, effectiveFrom: '2026-04-01', ctc: 1_400_000 }),
    ];
    assert.equal(compensationOn(history, '2026-09-08')?.ctc, 1_400_000);
  });

  it('applies a revision on its first day, not the day after', () => {
    const history = [revision({ effectiveFrom: '2026-04-01', ctc: 1_400_000 })];
    assert.equal(compensationOn(history, '2026-04-01')?.ctc, 1_400_000);
    assert.equal(compensationOn(history, '2026-03-31'), null);
  });

  it('is null when nothing has taken effect yet', () => {
    const history = [revision({ effectiveFrom: '2027-01-01' })];
    assert.equal(compensationOn(history, '2026-09-08'), null);
  });

  it('is null when there is no history at all', () => {
    // The normal case today: the table is empty for almost everyone.
    assert.equal(compensationOn([], '2026-09-08'), null);
  });

  it('does not care what order the rows arrive in', () => {
    const history = [
      revision({ id: 1, effectiveFrom: '2024-04-01', ctc: 900_000 }),
      revision({ id: 3, effectiveFrom: '2026-04-01', ctc: 1_400_000 }),
      revision({ id: 2, effectiveFrom: '2025-04-01', ctc: 1_100_000 }),
    ];
    assert.equal(compensationOn(history, '2026-09-08')?.ctc, 1_400_000);
  });
});

describe('vested units', () => {
  it('is the granted units times the vested share', () => {
    assert.equal(vestedUnits(revision({ esopUnits: 1000, esopVestedPct: 25 })), 250);
    assert.equal(vestedUnits(revision({ esopUnits: 1000, esopVestedPct: 100 })), 1000);
  });

  it('is zero before any vesting', () => {
    assert.equal(vestedUnits(revision({ esopUnits: 1000, esopVestedPct: 0 })), 0);
  });

  it('is zero when there is no grant', () => {
    assert.equal(vestedUnits(revision({ esopUnits: 0, esopVestedPct: 50 })), 0);
  });

  it('rounds to whole units — nobody owns a third of a share', () => {
    assert.equal(vestedUnits(revision({ esopUnits: 1000, esopVestedPct: 33.33 })), 333);
    assert.equal(vestedUnits(revision({ esopUnits: 7, esopVestedPct: 50 })), 4);
  });
});
