import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compensationOn, vestedUnits } from './compensation.domain';
import type { CompensationRecord } from './compensation.model';

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
