import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addedMinutes, editableDates, validateActivity } from './work-activity.domain';

const now = { date: '2026-10-17', time: '15:30:00' };
const ok = { date: '2026-10-17', type: 'phone_call', startTime: '14:00', endTime: '14:45', note: '' };
const badRequest = (err: { statusCode?: number }) => err.statusCode === 400;

test('today and the two days before are editable', () => {
  assert.deepEqual(editableDates('2026-10-01'), ['2026-10-01', '2026-09-30', '2026-09-29']);
});

test('a valid activity is cleaned and kept', () => {
  assert.deepEqual(validateActivity(ok, now), {
    date: '2026-10-17', type: 'phone_call', startTime: '14:00', endTime: '14:45', note: null,
  });
});

test('three days back is refused', () => {
  assert.throws(() => validateActivity({ ...ok, date: '2026-10-14' }, now), badRequest);
});

test('end must be after start, and not later than now today', () => {
  assert.throws(() => validateActivity({ ...ok, endTime: '14:00' }, now), badRequest);
  assert.throws(() => validateActivity({ ...ok, endTime: '16:00' }, now), badRequest);
  // A past day may end late in the evening.
  assert.doesNotThrow(() => validateActivity({ ...ok, date: '2026-10-16', endTime: '22:00' }, now));
});

test('"other" needs a note; unknown types are refused', () => {
  assert.throws(() => validateActivity({ ...ok, type: 'other' }, now), badRequest);
  assert.doesNotThrow(() => validateActivity({ ...ok, type: 'other', note: 'Vendor visit' }, now));
  assert.throws(() => validateActivity({ ...ok, type: 'lunch' }, now), badRequest);
});


test('activities add only the time outside check-in', () => {
  const punch = [{ from: '10:00', to: '18:00' }];
  assert.equal(addedMinutes(punch, [{ from: '15:00', to: '15:30' }], '20:00'), 0);
  assert.equal(addedMinutes(punch, [{ from: '19:00', to: '20:00' }], '20:00'), 60);
  assert.equal(addedMinutes(punch, [{ from: '17:30', to: '18:45' }], '20:00'), 45);
  assert.equal(addedMinutes([{ from: '10:00', to: null }], [{ from: '09:00', to: '10:30' }], '12:00'), 60);
});
