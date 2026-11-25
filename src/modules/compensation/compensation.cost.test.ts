import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { countablePay, lastDayOfMonth } from './compensation.domain';
import type { CompensationRecord } from './compensation.model';

const pay = (over: Partial<CompensationRecord> = {}): CompensationRecord => ({
  id: 1,
  employeeId: 336,
  effectiveFrom: '2026-04-01',
  ctc: 600000,
  variablePay: 0,
  bonus: 0,
  esopUnits: 0,
  esopVestedPct: 0,
  revisionNote: null,
  createdAt: '2026-04-01 10:00:00',
  ...over,
});

describe('salary cost for a month', () => {
  it('reads a month as its last day, so a mid-month raise counts for that month', () => {
    assert.equal(lastDayOfMonth('2026-10'), '2026-10-31');
    assert.equal(lastDayOfMonth('2026-11'), '2026-11-30');
    assert.equal(lastDayOfMonth('2026-02'), '2026-02-28');
    assert.equal(lastDayOfMonth('2028-02'), '2028-02-29');
  });

  it('rejects anything that is not a real YYYY-MM', () => {
    for (const bad of ['2026-13', '2026-00', '2026-1', '26-10', '2026-10-01', '']) {
      assert.equal(lastDayOfMonth(bad), null, bad);
    }
  });

  it('counts real pay', () => {
    assert.equal(countablePay(pay())?.ctc, 600000);
  });

  it('never counts a placeholder or a missing salary as cost', () => {
    assert.equal(countablePay(pay({ isPlaceholder: true })), null);
    assert.equal(countablePay(null), null);
    assert.equal(countablePay(undefined), null);
  });
});
