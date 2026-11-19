import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BREAK_ALLOWANCE_MINUTES,
  deviceLabel,
  effectiveEnd,
  endVerdict,
  isDeviceId,
  shiftBounds,
  startVerdict,
  usedMinutes,
  type BreakRecord,
} from './break.domain';

const LAPTOP = 'laptop-1234-abcd';
const PHONE = 'phone-5678-efgh';

const brk = (over: Partial<BreakRecord> = {}): BreakRecord => ({
  id: 1,
  startedAt: '2026-11-20 13:00',
  endedAt: null,
  endsBy: '2026-11-20 14:00',
  startDevice: LAPTOP,
  startDeviceLabel: 'Chrome on Windows',
  startZone: 'office',
  ...over,
});

const DAY = shiftBounds('2026-11-20', '10:00', '19:00');

test('one hour in total', () => {
  assert.equal(BREAK_ALLOWANCE_MINUTES, 60);
});

test('a night shift ends on the next calendar day', () => {
  assert.deepEqual(shiftBounds('2026-11-20', '21:00', '06:00'), {
    start: '2026-11-20 21:00',
    end: '2026-11-21 06:00',
  });
  assert.deepEqual(DAY, { start: '2026-11-20 10:00', end: '2026-11-20 19:00' });
});

test('a break nobody ends stops at its endsBy; until then it is running', () => {
  assert.equal(effectiveEnd(brk(), '2026-11-20 13:30'), null);
  assert.equal(effectiveEnd(brk(), '2026-11-20 14:00'), '2026-11-20 14:00');
  assert.equal(effectiveEnd(brk({ endedAt: '2026-11-20 13:20' }), '2026-11-20 18:00'), '2026-11-20 13:20');
});

test('used minutes add closed pieces and the running one up to now', () => {
  const breaks = [
    brk({ id: 1, startedAt: '2026-11-20 11:00', endedAt: '2026-11-20 11:15', endsBy: '2026-11-20 12:00' }),
    brk({ id: 2, startedAt: '2026-11-20 13:00', endsBy: '2026-11-20 13:45' }),
  ];
  assert.equal(usedMinutes(breaks, '2026-11-20 13:10'), 25);
  // Past its endsBy the running one counts only up to endsBy.
  assert.equal(usedMinutes(breaks, '2026-11-20 16:00'), 60);
});

test('start: only checked in, one at a time, inside the shift, while time is left', () => {
  const now = '2026-11-20 13:00';
  assert.deepEqual(startVerdict({ checkedIn: false, now, shift: DAY, breaks: [] }), {
    ok: false,
    message: 'Check in first to start a break.',
  });
  assert.deepEqual(startVerdict({ checkedIn: true, now, shift: DAY, breaks: [brk({ startedAt: '2026-11-20 12:50' })] }), {
    ok: false,
    message: 'You are already on a break since 12:50.',
  });
  assert.equal(startVerdict({ checkedIn: true, now: '2026-11-20 09:55', shift: DAY, breaks: [] }).ok, false);
  assert.equal(startVerdict({ checkedIn: true, now: '2026-11-20 19:00', shift: DAY, breaks: [] }).ok, false);

  const usedUp = [brk({ startedAt: '2026-11-20 11:00', endedAt: '2026-11-20 12:00' })];
  assert.deepEqual(startVerdict({ checkedIn: true, now, shift: DAY, breaks: usedUp }), {
    ok: false,
    message: 'You have used your full 1 hour of break for this shift.',
  });
});

test('start: ends by itself when the hour left runs out, or at the shift end', () => {
  const took20 = [brk({ startedAt: '2026-11-20 11:00', endedAt: '2026-11-20 11:20' })];
  assert.deepEqual(startVerdict({ checkedIn: true, now: '2026-11-20 13:00', shift: DAY, breaks: took20 }), {
    ok: true,
    endsBy: '2026-11-20 13:40',
  });
  assert.deepEqual(startVerdict({ checkedIn: true, now: '2026-11-20 18:30', shift: DAY, breaks: [] }), {
    ok: true,
    endsBy: '2026-11-20 19:00',
  });
  // A night shift's break runs across midnight.
  const night = shiftBounds('2026-11-20', '21:00', '06:00');
  assert.deepEqual(startVerdict({ checkedIn: true, now: '2026-11-20 23:30', shift: night, breaks: [] }), {
    ok: true,
    endsBy: '2026-11-21 00:30',
  });
});

test('end: same device, same place', () => {
  const running = brk();
  assert.deepEqual(endVerdict({ running, deviceId: LAPTOP, zone: 'office' }), { ok: true });

  // Started on the office laptop, ended from a phone: refused, naming the laptop.
  const phone = endVerdict({ running, deviceId: PHONE, zone: 'office' });
  assert.equal(phone.ok, false);
  assert.match(phone.ok ? '' : phone.message, /same device you started it on \(Chrome on Windows\)/);
  assert.match(phone.ok ? '' : phone.message, /ends by itself at 14:00/);

  // A WFO person who started at the office cannot end it from home.
  assert.deepEqual(endVerdict({ running, deviceId: LAPTOP, zone: 'home' }), {
    ok: false,
    message: 'You started your break at the office. End it there.',
  });

  // Not fenced (Hybrid): the device alone decides.
  assert.deepEqual(endVerdict({ running: brk({ startZone: null }), deviceId: LAPTOP, zone: null }), { ok: true });
  assert.equal(endVerdict({ running: null, deviceId: LAPTOP, zone: null }).ok, false);
});

test('device ids and labels', () => {
  assert.equal(isDeviceId('3f2b9c1e-8d4a-4b5f-9a1c-0e2d3f4a5b6c'), true);
  assert.equal(isDeviceId('short'), false);
  assert.equal(isDeviceId("x'; DROP TABLE"), false);
  assert.equal(isDeviceId(undefined), false);

  assert.equal(
    deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'),
    'Chrome on Windows',
  );
  assert.equal(
    deviceLabel('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36'),
    'Chrome on Android phone',
  );
  assert.equal(
    deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'),
    'Safari on iPhone',
  );
  assert.equal(deviceLabel(undefined), null);
});
