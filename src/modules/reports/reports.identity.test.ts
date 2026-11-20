import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildIdentities, headOfLine, withStandardColumns, type IdentityRow } from './reports.identity';
import type { ReportResult } from './reports.model';

const person = (id: number, name: string, managerId: number | null, managerName: string | null = null): IdentityRow => ({
  id,
  employee_code: `BAM-${id}`,
  full_name: name,
  designation: 'Engineer',
  department: 'Tech',
  manager_id: managerId,
  manager_name: managerName,
});

// Sajan → Komal → Ashish (no manager)
const ROWS = [person(1, 'Ashish', null), person(2, 'Komal', 1, 'Ashish'), person(3, 'Sajan', 2, 'Komal')];

describe('headOfLine', () => {
  const managerOf = new Map(ROWS.map((r) => [r.id, r.manager_id]));

  it('walks up to the person with no manager', () => {
    assert.equal(headOfLine(3, managerOf), 1);
    assert.equal(headOfLine(2, managerOf), 1);
  });

  it('makes someone with no manager their own head', () => {
    assert.equal(headOfLine(1, managerOf), 1);
  });

  it('stops on a loop instead of spinning', () => {
    const loop = new Map<number, number | null>([
      [1, 2],
      [2, 1],
    ]);
    assert.ok([1, 2].includes(headOfLine(1, loop)));
  });

  it('stops where a manager id points at nobody', () => {
    const broken = new Map<number, number | null>([[5, 99]]);
    assert.equal(headOfLine(5, broken), 5);
  });
});

describe('withStandardColumns', () => {
  const identities = buildIdentities(ROWS);
  const report: ReportResult = {
    type: 'active',
    meta: {
      companyName: '',
      companyAddress: '',
      reportTitle: 'x',
      generatedAt: '',
      totalRecords: 2,
    },
    columns: [
      { key: 'date', label: 'Date' },
      { key: 'code', label: 'Code' },
      { key: 'employee', label: 'Employee' },
      { key: 'hours', label: 'Hours' },
    ],
    rows: [
      { _employeeId: 3, date: '19 Nov', code: 'BAM-3', employee: 'Sajan', hours: 8 },
      { date: '', code: 'Total', employee: '', hours: 8 },
    ],
  };
  const out = withStandardColumns(report, identities);

  it('puts the six first and drops the old identity columns', () => {
    assert.deepEqual(
      out.columns.map((c) => c.key),
      ['stdEmpId', 'stdEmpName', 'stdManager', 'stdDesignation', 'stdDepartment', 'stdHeadOfDepartment', 'date', 'hours'],
    );
  });

  it('fills each row from the lookup, head of department included', () => {
    assert.equal(out.rows[0].stdEmpName, 'Sajan');
    assert.equal(out.rows[0].stdManager, 'Komal');
    assert.equal(out.rows[0].stdHeadOfDepartment, 'Ashish');
    assert.equal('_employeeId' in out.rows[0], false);
  });

  it('keeps a Total row labelled', () => {
    assert.equal(out.rows[1].stdEmpId, 'Total');
    assert.equal(out.rows[1].stdEmpName, '');
  });
});
