import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { breakDayRows, maxBreaks } from './reports.breaks';
import type { RawBreakRow } from './reports.repository.interface';

const brk = (
  employeeId: number,
  day: string,
  start: string,
  end: string | null,
  endsBy: string,
  reason: string | null = 'self',
): RawBreakRow => ({
  employee_id: employeeId,
  work_date: day,
  started_at: `${day} ${start}`,
  ended_at: end ? `${day} ${end}` : null,
  ends_by: `${day} ${endsBy}`,
  end_reason: end ? reason : null,
});

const NOW = '2026-11-19 20:00';

describe('breakDayRows', () => {
  const rows = breakDayRows(
    [
      brk(1, '2026-11-19', '13:00', '13:20', '14:00'),
      brk(1, '2026-11-19', '15:00', '15:25', '15:40'),
      brk(1, '2026-11-19', '17:00', '17:10', '17:15', 'checkout'),
      brk(2, '2026-11-19', '14:00', null, '15:00'),
    ],
    NOW,
  );

  it('gives each break its own cell, in order', () => {
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0].breaks, [
      '13:00–13:20 (20 min)',
      '15:00–15:25 (25 min)',
      '17:00–17:10 (10 min, ended at check-out)',
    ]);
  });

  it('totals the day and shows what is left of the hour', () => {
    assert.equal(rows[0].totalMinutes, 55);
    assert.equal(rows[0].remainingMinutes, 5);
  });

  it('reads an unended break as stopped at its limit once that has passed', () => {
    assert.deepEqual(rows[1].breaks, ['14:00–15:00 (60 min, stopped automatically)']);
    assert.equal(rows[1].remainingMinutes, 0);
  });

  it('shows a break still inside its limit as running', () => {
    const [day] = breakDayRows([brk(3, '2026-11-19', '19:50', null, '20:30')], NOW);
    assert.equal(day.breaks[0], '19:50–running (10 min so far)');
  });

  it('sizes the Break N columns by the busiest day', () => {
    assert.equal(maxBreaks(rows), 3);
    assert.equal(maxBreaks([]), 0);
  });
});
