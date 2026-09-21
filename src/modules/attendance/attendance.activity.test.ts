import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  activeHoursFromSlots,
  attendanceOf,
  calendarWeek,
  countSlots,
  EMPTY_SLOTS,
  hasSlot,
  readDayAsObserved,
  resolveDayStatus,
  seenBetween,
  segmentsOf,
  slotOf,
  slotsForShiftDay,
  slotStartsAt,
  SLOTS_PER_DAY,
  withSlot,
  type DayFacts,
  type SlotMask,
} from './attendance.domain';

/** A mask from a list of slot numbers. */
const mask = (...slots: number[]): SlotMask =>
  slots.reduce<SlotMask>((m, slot) => withSlot(m, slot), EMPTY_SLOTS);

/**
 * A mask from clock times, inclusive of the first slot, exclusive of the last.
 * '24:00' is accepted as "to the end of the day" — it is not a time `minutesOf`
 * will take, but it is the natural way to write a stretch that runs to midnight.
 */
const between = (from: string, to: string): SlotMask => {
  const end = to === '24:00' ? SLOTS_PER_DAY : slotOf(to);
  let m = EMPTY_SLOTS;
  for (let slot = slotOf(from); slot < end; slot++) m = withSlot(m, slot);
  return m;
};

const facts = (over: Partial<DayFacts> = {}): DayFacts => ({
  date: '2026-09-08', // a Tuesday
  today: '2026-09-08',
  weeklyOff: ['Sun'],
  holidayName: null,
  leave: null,
  punch: null,
  shiftStart: '10:00',
  lateGraceMinutes: 15,
  ...over,
});

describe('slots and the clock', () => {
  it('cuts the day into 48 half hours', () => {
    assert.equal(SLOTS_PER_DAY, 48);
  });

  it('puts every minute of a half hour in the same slot', () => {
    assert.equal(slotOf('10:00'), 20);
    assert.equal(slotOf('10:04'), 20);
    assert.equal(slotOf('10:29'), 20);
    assert.equal(slotOf('10:30'), 21);
  });

  it('names the start of each slot', () => {
    assert.equal(slotStartsAt(0), '00:00');
    assert.equal(slotStartsAt(20), '10:00');
    assert.equal(slotStartsAt(47), '23:30');
  });

  it('survives past bit 31, where 32-bit bitwise maths would break', () => {
    // The trap: `1 << 40` in JS is 256, not 2^40. Slot 40 is 20:00, an
    // ordinary evening, so this is not a theoretical case.
    const evening = mask(40, 47);
    assert.ok(hasSlot(evening, 40));
    assert.ok(hasSlot(evening, 47));
    assert.ok(!hasSlot(evening, 39));
    assert.equal(countSlots(evening), 2);
  });

  it('is idempotent — seeing the same half hour twice changes nothing', () => {
    const once = withSlot(EMPTY_SLOTS, 20);
    assert.equal(withSlot(once, 20), once);
  });
});

describe('hours from slots', () => {
  it('is half an hour per slot', () => {
    assert.equal(activeHoursFromSlots(mask(20)), 0.5);
    assert.equal(activeHoursFromSlots(mask(20, 21)), 1);
    assert.equal(activeHoursFromSlots(between('10:00', '19:00')), 9);
  });

  it('is zero when nothing was seen', () => {
    assert.equal(activeHoursFromSlots(EMPTY_SLOTS), 0);
  });

  it('counts only the half hours that had something in them', () => {
    // The worked example: 10:00-13:30, lunch, 14:30-17:00, a gap, 17:30-19:30.
    const day = between('10:00', '13:30') | between('14:30', '17:00') | between('17:30', '19:30');
    assert.equal(activeHoursFromSlots(day), 8);
    // The span is longer than the total, and that difference is the point.
    const seen = seenBetween(day);
    assert.deepEqual(seen, { first: '10:00', last: '19:30' });
  });

  it('never exceeds a full day', () => {
    let all = EMPTY_SLOTS;
    for (let slot = 0; slot < SLOTS_PER_DAY; slot++) all = withSlot(all, slot);
    assert.equal(activeHoursFromSlots(all), 24);
  });
});

describe('first and last seen', () => {
  it('reports the end of the last active half hour, not its start', () => {
    // One slot of activity at 10:00 means the person was seen between 10:00
    // and 10:30 — reporting "10:00 to 10:00" would read as no time at all.
    assert.deepEqual(seenBetween(mask(20)), { first: '10:00', last: '10:30' });
  });

  it('is null both ways when nothing was seen', () => {
    assert.deepEqual(seenBetween(EMPTY_SLOTS), { first: null, last: null });
  });

  it('wraps to midnight when the last slot of the day is active', () => {
    assert.deepEqual(seenBetween(mask(47)), { first: '23:30', last: '00:00' });
  });
});

describe('folding a night onto the day it started', () => {
  const NIGHT_START = '23:00';
  const NIGHT_END = '07:00';

  it('leaves a day shift entirely alone', () => {
    const day = between('10:00', '19:00');
    assert.equal(slotsForShiftDay(day, between('10:00', '12:00'), '10:00', '19:00'), day);
  });

  it('joins the evening to the following morning', () => {
    const evening = between('23:00', '24:00'); // slots 46, 47 on the shift date
    const morning = between('00:00', '07:00'); // slots 0..13 on the next date
    const folded = slotsForShiftDay(evening, morning, NIGHT_START, NIGHT_END);
    assert.equal(activeHoursFromSlots(folded), 8);
  });

  it('refuses the next day\'s slots once the shift has ended', () => {
    // 09:00 the following morning is that person's own time, not this shift.
    const morning = between('00:00', '07:00') | between('09:00', '11:00');
    const folded = slotsForShiftDay(EMPTY_SLOTS, morning, NIGHT_START, NIGHT_END);
    assert.equal(activeHoursFromSlots(folded), 7);
    assert.ok(!hasSlot(folded, slotOf('09:00')));
  });

  it('refuses the shift date\'s own early hours — they belong to the night before', () => {
    // Activity at 02:00 on the shift date is the TAIL of yesterday's night.
    // Counting it here would bill one night's hours to two different days.
    const ownDate = between('02:00', '05:00') | between('23:00', '24:00');
    const folded = slotsForShiftDay(ownDate, EMPTY_SLOTS, NIGHT_START, NIGHT_END);
    assert.equal(activeHoursFromSlots(folded), 1);
    assert.ok(!hasSlot(folded, slotOf('02:00')));
  });

  it('agrees with shiftDateOf about the boundary, inclusively', () => {
    // shiftDateOf treats a moment AT the shift end as belonging to yesterday.
    const morning = mask(slotOf('07:00'));
    const folded = slotsForShiftDay(EMPTY_SLOTS, morning, NIGHT_START, NIGHT_END);
    assert.ok(hasSlot(folded, slotOf('07:00')));
  });

  it('splits one night cleanly across two calendar rows', () => {
    // What the database actually holds for someone on 23:00-07:00: two rows.
    const monday = between('22:30', '24:00');
    const tuesday = between('00:00', '07:00') | between('23:00', '24:00');
    const mondayNight = slotsForShiftDay(monday, tuesday, NIGHT_START, NIGHT_END);
    // 22:30 is before the shift but still worked, and still counted.
    assert.equal(activeHoursFromSlots(mondayNight), 8.5);
  });
});

describe('a day resolved from observation', () => {
  it('is On time whenever anything was seen — never Late', () => {
    // Forty minutes on a call before touching the portal is not lateness, and
    // this is the single most damaging thing the feature could get wrong.
    const late = attendanceOf(facts({ slots: between('10:40', '19:00') }));
    assert.equal(late.status, 'On time');
    assert.equal(late.lateByMinutes, 0);
  });

  it('is Absent on a finished day with nothing seen', () => {
    assert.equal(
      resolveDayStatus(facts({ date: '2026-09-07', today: '2026-09-08', slots: EMPTY_SLOTS })),
      'Absent',
    );
  });

  it('is Not in yet on a day still running', () => {
    assert.equal(resolveDayStatus(facts({ slots: EMPTY_SLOTS })), 'Not in yet');
  });

  it('keeps leave, holidays and weekly offs ahead of observation', () => {
    const worked = between('10:00', '19:00');
    assert.equal(resolveDayStatus(facts({ slots: worked, holidayName: 'Diwali' })), 'Holiday');
    assert.equal(
      resolveDayStatus(facts({ date: '2026-09-13', slots: worked })), // a Sunday
      'Weekly off',
    );
    assert.equal(
      resolveDayStatus(facts({ slots: worked, leave: { type: 'Casual', isHalfDay: false } })),
      'Leave',
    );
  });

  it('still reports the hours worked on a weekly off', () => {
    // Same rule as a punch on a Saturday: the day is named for what it was,
    // and the hours are reported anyway.
    const sunday = attendanceOf(facts({ date: '2026-09-13', slots: between('10:00', '14:00') }));
    assert.equal(sunday.status, 'Weekly off');
    assert.equal(sunday.activeHours, 4);
  });

  it('reports first and last seen in place of the punches', () => {
    const day = attendanceOf(facts({ slots: between('09:30', '18:00') }));
    assert.equal(day.loginAt, '09:30');
    assert.equal(day.logoutAt, '18:00');
  });

  it('treats an empty mask as an answer, and no mask as a different question', () => {
    // Empty means "the portals saw nothing"; absent means "this person punches".
    assert.equal(attendanceOf(facts({ slots: EMPTY_SLOTS, date: '2026-09-07' })).status, 'Absent');
    assert.equal(attendanceOf(facts({ date: '2026-09-07' })).status, 'Absent');
    // ... and the punch path is untouched by any of this.
    const punched = attendanceOf(facts({ punch: { loginAt: '10:40', logoutAt: '19:00' } }));
    assert.equal(punched.status, 'Late');
    assert.equal(punched.lateByMinutes, 40);
  });

  it('prefers slots over a punch if somehow given both', () => {
    // Not expected — the service sends one or the other — but the precedence
    // must be stated rather than left to whichever branch runs first.
    const both = attendanceOf(
      facts({ slots: between('10:00', '12:00'), punch: { loginAt: '10:00', logoutAt: '19:00' } }),
    );
    assert.equal(both.activeHours, 2);
  });
});

describe('the stretches behind the bar', () => {
  it('reports one range per unbroken run, in order', () => {
    const day = between('10:00', '13:30') | between('14:30', '17:00') | between('17:30', '19:30');
    assert.deepEqual(segmentsOf(day), [
      { from: '10:00', to: '13:30' },
      { from: '14:30', to: '17:00' },
      { from: '17:30', to: '19:30' },
    ]);
  });

  it('is empty when nothing was seen', () => {
    assert.deepEqual(segmentsOf(EMPTY_SLOTS), []);
  });

  it('merges adjacent half hours rather than listing them one by one', () => {
    // Six slots, one range — otherwise the hover box would be a wall of rows.
    assert.deepEqual(segmentsOf(between('10:00', '13:00')), [{ from: '10:00', to: '13:00' }]);
  });

  it('says 24:00, not 00:00, for a stretch that runs to midnight', () => {
    assert.deepEqual(segmentsOf(between('22:00', '24:00')), [{ from: '22:00', to: '24:00' }]);
  });

  it('reads a night forwards when walked from the shift start', () => {
    // A folded night holds slots at BOTH ends of the clock. Walked from
    // midnight it reports the morning first, which is the wrong order and
    // reads as two separate stints.
    const night = between('23:00', '24:00') | between('00:00', '07:00');
    assert.deepEqual(segmentsOf(night), [
      { from: '00:00', to: '07:00' },
      { from: '23:00', to: '24:00' },
    ]);
    // Walked from the shift's own start it is one continuous night.
    assert.deepEqual(segmentsOf(night, slotOf('23:00')), [{ from: '23:00', to: '07:00' }]);
  });

  it('keeps a real break inside a night separate', () => {
    const night = between('23:00', '24:00') | between('01:00', '07:00');
    // Midnight as an END is always '24:00'. '00:00' there would read either as
    // the start of the day or as no elapsed time at all.
    assert.deepEqual(segmentsOf(night, slotOf('23:00')), [
      { from: '23:00', to: '24:00' },
      { from: '01:00', to: '07:00' },
    ]);
  });

  it('comes out of attendanceOf for both kinds of day', () => {
    const observed = attendanceOf(facts({ slots: between('10:00', '12:00') }));
    assert.deepEqual(observed.segments, [{ from: '10:00', to: '12:00' }]);

    const punched = attendanceOf(facts({ punch: { loginAt: '10:04', logoutAt: '19:22' } }));
    assert.deepEqual(punched.segments, [{ from: '10:04', to: '19:22' }]);

    // Still checked in: the end is unknown, not invented.
    const running = attendanceOf(facts({ punch: { loginAt: '10:04', logoutAt: null } }));
    assert.deepEqual(running.segments, [{ from: '10:04', to: null }]);

    assert.deepEqual(attendanceOf(facts({ date: '2026-09-07' })).segments, []);
  });
});

describe('which method reads a given day', () => {
  const worked = between('10:00', '12:00');

  it('reads a punch person by their punches, always', () => {
    assert.equal(readDayAsObserved(false, worked, true), false);
    assert.equal(readDayAsObserved(false, EMPTY_SLOTS, false), false);
  });

  it('reads an observed day from its slots', () => {
    assert.equal(readDayAsObserved(true, worked, false), true);
  });

  it('prefers slots even when a punch also exists for that day', () => {
    assert.equal(readDayAsObserved(true, worked, true), true);
  });

  it('keeps a punched day that has no slots — history is not rewritten', () => {
    // The case that matters: somebody switched to observation on Friday. Monday
    // to Thursday have punches and no slots, and must not blank out.
    assert.equal(readDayAsObserved(true, EMPTY_SLOTS, true), false);
  });

  it('reads an empty, unpunched day as observed so lateness is not invented', () => {
    assert.equal(readDayAsObserved(true, EMPTY_SLOTS, false), true);
  });
});

describe('the calendar week', () => {
  // 2026-09-11 is a Friday; its week runs Mon 7th to Sun 13th.
  it('runs Monday to Sunday around any day in it', () => {
    const week = calendarWeek('2026-09-11');
    assert.equal(week.length, 7);
    assert.equal(week[0], '2026-09-07');
    assert.equal(week[6], '2026-09-13');
  });

  it('gives the same week for every day inside it', () => {
    const friday = calendarWeek('2026-09-11');
    for (const date of friday) assert.deepEqual(calendarWeek(date), friday);
  });

  it('starts on the Monday when today IS Monday', () => {
    assert.equal(calendarWeek('2026-09-07')[0], '2026-09-07');
  });

  it('keeps Sunday at the END of its own week, not the start of the next', () => {
    // The trap: Date.getUTCDay() makes Sunday 0, so a naive shift puts Sunday
    // at the head of the following week and the chart jumps a day early.
    const week = calendarWeek('2026-09-13'); // a Sunday
    assert.equal(week[0], '2026-09-07');
    assert.equal(week[6], '2026-09-13');
  });

  it('crosses a month boundary without comment', () => {
    const week = calendarWeek('2026-10-01'); // a Thursday
    assert.equal(week[0], '2026-09-28');
    assert.equal(week[6], '2026-10-04');
  });

  it('crosses a year boundary too', () => {
    const week = calendarWeek('2027-01-01'); // a Friday
    assert.equal(week[0], '2026-12-28');
    assert.equal(week[6], '2027-01-03');
  });
});
