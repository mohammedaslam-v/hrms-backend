import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ACTIVITY_MEASURED_ROLES, isActivityMeasured } from './attendance.config';

describe('who is measured by activity', () => {
  it('covers all configured roles', () => {
    for (const role of ACTIVITY_MEASURED_ROLES) {
      assert.equal(isActivityMeasured(role), true, `${role} should be activity measured`);
    }
  });

  it('contains the expected 11 roles', () => {
    assert.deepEqual([...ACTIVITY_MEASURED_ROLES], [
      'Admin',
      'SuperAdmin',
      'CSR',
      'RegionalAdmin',
      'ESM_CSM',
      'SSM',
      'Teacher Ops',
      'HR',
      'Tech',
      'Lead',
      'TSM',
    ]);
  });

  it('leaves unconfigured roles on check-in and check-out', () => {
    for (const role of ['Driver', 'Office Assistant', 'Chef', 'Accountant']) {
      assert.equal(isActivityMeasured(role), false, `${role} should punch`);
    }
  });

  it('ignores casing, so a differently-typed role still matches', () => {
    assert.equal(isActivityMeasured('csr'), true);
    assert.equal(isActivityMeasured('Csr'), true);
    assert.equal(isActivityMeasured('ssm'), true);
    assert.equal(isActivityMeasured('admin'), true);
    assert.equal(isActivityMeasured('superadmin'), true);
    assert.equal(isActivityMeasured('teacher ops'), true);
    assert.equal(isActivityMeasured('hr'), true);
    assert.equal(isActivityMeasured('tech'), true);
    assert.equal(isActivityMeasured('lead'), true);
    assert.equal(isActivityMeasured('tsm'), true);
  });

  it('checks designation if provided as fallback', () => {
    assert.equal(isActivityMeasured(null, 'TSM'), true);
    assert.equal(isActivityMeasured(null, 'Teacher Ops'), true);
    assert.equal(isActivityMeasured(null, 'Driver'), false);
  });

  it('falls back to punching for an employee with no role or designation', () => {
    assert.equal(isActivityMeasured(null), false);
    assert.equal(isActivityMeasured(null, null), false);
  });

  it('does not match on a partial name', () => {
    assert.equal(isActivityMeasured('CSR Manager'), false);
    assert.equal(isActivityMeasured('CS'), false);
    assert.equal(isActivityMeasured('Technical'), false);
  });
});
