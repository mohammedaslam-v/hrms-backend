import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  activeHours,
  attendanceOf,
  crossesMidnight,
  dayNameOf,
  eachDate,
  lastDays,
  isLate,
  isWeeklyOff,
  minutesLate,
  minutesOf,
  resolveDayStatus,
  shiftDateOf,
  weekBars,
  type DayAttendance,
  type DayFacts,
} from './attendance';

const GRACE = 15;

const facts = (over: Partial<DayFacts> = {}): DayFacts => ({
  date: '2026-09-02', // a Wednesday
  today: '2026-09-06',
  weeklyOff: ['Sun'],
  holidayName: null,
  leave: null,
  punch: null,
  shiftStart: '10:00',
  lateGraceMinutes: GRACE,
  ...over,
});

const day = (date: string, hours: number): DayAttendance => ({
  date,
  status: 'On time',
  loginAt: '10:00',
  logoutAt: '19:00',
  activeHours: hours,
  lateByMinutes: 0,
});

describe('reading times and dates', () => {
  it('converts a time to minutes since midnight', () => {
    assert.equal(minutesOf('00:00'), 0);
    assert.equal(minutesOf('10:05'), 605);
    assert.equal(minutesOf('23:59'), 1439);
  });

  it('accepts the HH:MM:SS the driver returns for a TIME column', () => {
    assert.equal(minutesOf('10:05:00'), 605);
    // Seconds are dropped, not rounded — 10:05:59 is still 10:05.
    assert.equal(minutesOf('10:05:59'), 605);
  });

  it('refuses anything that is not a time', () => {
    for (const bad of ['24:00', '10:60', '1000', '', 'now']) {
      assert.throws(() => minutesOf(bad), /Not a time/);
    }
  });

  it('names the weekday of a date', () => {
    assert.equal(dayNameOf('2026-09-06'), 'Sun');
    assert.equal(dayNameOf('2026-09-02'), 'Wed');
  });

  it('recognises the employee’s own weekly off', () => {
    assert.equal(isWeeklyOff('2026-09-06', ['Sun']), true);
    assert.equal(isWeeklyOff('2026-09-05', ['Sun']), false);
    // Weekly offs are per employee, not per company.
    assert.equal(isWeeklyOff('2026-09-05', ['Sat', 'Sun']), true);
  });
});

describe('lateness', () => {
  it('counts minutes past the start of the shift', () => {
    assert.equal(minutesLate('10:20', '10:00'), 20);
  });

  it('treats arriving early as zero, never as credit', () => {
    assert.equal(minutesLate('09:30', '10:00'), 0);
    assert.equal(minutesLate('10:00', '10:00'), 0);
  });

  it('is late only PAST the grace window, not at it', () => {
    // 15 minutes exactly is on time. This boundary is the whole definition.
    assert.equal(isLate(15, GRACE), false);
    assert.equal(isLate(16, GRACE), true);
  });

  it('follows the configured grace window rather than a constant', () => {
    assert.equal(isLate(20, 30), false);
    assert.equal(isLate(20, 10), true);
  });
});

describe('active hours', () => {
  it('is the span between the two punches', () => {
    assert.equal(activeHours({ loginAt: '10:00', logoutAt: '19:00' }), 9);
    assert.equal(activeHours({ loginAt: '10:15', logoutAt: '18:45' }), 8.5);
  });

  it('rounds to two decimal places, matching the column', () => {
    // 10:00 to 18:50 is 530 minutes = 8.8333… hours
    assert.equal(activeHours({ loginAt: '10:00', logoutAt: '18:50' }), 8.83);
  });

  it('is zero while the person is still checked in', () => {
    assert.equal(activeHours({ loginAt: '10:00', logoutAt: null }), 0);
  });

  it('wraps past midnight rather than going negative', () => {
    // A check-out earlier than the check-in means the clock passed midnight.
    assert.equal(activeHours({ loginAt: '23:10', logoutAt: '07:05' }), 7.92);
    assert.equal(activeHours({ loginAt: '18:30', logoutAt: '02:45' }), 8.25);
    assert.equal(activeHours({ loginAt: '23:00', logoutAt: '07:00' }), 8);
  });

  it('is zero when the two punches are the same moment', () => {
    assert.equal(activeHours({ loginAt: '10:00', logoutAt: '10:00' }), 0);
  });

  it('refuses a wrapped span longer than a plausible stint', () => {
    // 10:00 to 09:00 wraps to 23 hours. Nobody worked 23 hours; the pair is a
    // data error, usually a hand correction, and inventing a figure is worse
    // than reporting none.
    assert.equal(activeHours({ loginAt: '10:00', logoutAt: '09:00' }), 0);
    // 18 hours exactly is the limit and still counts.
    assert.equal(activeHours({ loginAt: '20:00', logoutAt: '14:00' }), 18);
    assert.equal(activeHours({ loginAt: '20:00', logoutAt: '14:01' }), 0);
  });
});

describe('what a day was — precedence', () => {
  it('1. a declared holiday beats everything', () => {
    const status = resolveDayStatus(
      facts({
        holidayName: 'Company offsite',
        // even with all of these also true
        date: '2026-09-06',
        weeklyOff: ['Sun'],
        leave: { type: 'Earned', isHalfDay: false },
        punch: { loginAt: '10:00', logoutAt: '19:00' },
      }),
    );
    assert.equal(status, 'Holiday');
  });

  it('2. a weekly off beats leave and a punch', () => {
    const status = resolveDayStatus(
      facts({
        date: '2026-09-06', // Sunday
        leave: { type: 'Earned', isHalfDay: false },
        punch: { loginAt: '10:00', logoutAt: '19:00' },
      }),
    );
    assert.equal(status, 'Weekly off');
  });

  it('3. approved leave beats absence — the rule that matters most', () => {
    // Get this order wrong and someone on approved leave is marked absent.
    const status = resolveDayStatus(
      facts({ date: '2026-09-01', leave: { type: 'Earned', isHalfDay: false } }),
    );
    assert.equal(status, 'Leave');
  });

  it('3b. a half-day leave reads as Half day', () => {
    const status = resolveDayStatus(
      facts({ leave: { type: 'Casual', isHalfDay: true } }),
    );
    assert.equal(status, 'Half day');
  });

  it('4. a punch inside the grace window is On time', () => {
    assert.equal(
      resolveDayStatus(facts({ punch: { loginAt: '10:15', logoutAt: '19:00' } })),
      'On time',
    );
  });

  it('4b. a punch past the grace window is Late', () => {
    assert.equal(
      resolveDayStatus(facts({ punch: { loginAt: '10:16', logoutAt: '19:00' } })),
      'Late',
    );
  });

  it('5. today with no punch yet is Not in yet, not Absent', () => {
    // Nobody is absent at half past ten in the morning.
    // 7 Sep is a Monday — a working day, so the weekly-off branch cannot mask this.
    assert.equal(resolveDayStatus(facts({ date: '2026-09-07', today: '2026-09-07' })), 'Not in yet');
  });

  it('5c. a weekly off still wins on today — it is an off day, not a pending one', () => {
    assert.equal(resolveDayStatus(facts({ date: '2026-09-06', today: '2026-09-06' })), 'Weekly off');
  });

  it('5b. a future working day is Not in yet', () => {
    assert.equal(resolveDayStatus(facts({ date: '2026-09-10', today: '2026-09-06' })), 'Not in yet');
  });

  it('6. a past working day with no punch is an absence', () => {
    assert.equal(resolveDayStatus(facts({ date: '2026-09-01', today: '2026-09-06' })), 'Absent');
  });
});

describe('a whole day resolved', () => {
  it('carries the hours and the lateness alongside the status', () => {
    const d = attendanceOf(facts({ punch: { loginAt: '10:25', logoutAt: '19:10' } }));
    assert.equal(d.status, 'Late');
    assert.equal(d.lateByMinutes, 25);
    assert.equal(d.activeHours, 8.75);
    assert.equal(d.loginAt, '10:25');
  });

  it('still counts hours worked on a weekly off', () => {
    // The day reads as the off day it was, but a Sunday shift is not invisible.
    const d = attendanceOf(
      facts({ date: '2026-09-06', punch: { loginAt: '11:00', logoutAt: '15:00' } }),
    );
    assert.equal(d.status, 'Weekly off');
    assert.equal(d.activeHours, 4);
  });

  it('still counts the half worked around a half-day leave', () => {
    const d = attendanceOf(
      facts({
        leave: { type: 'Casual', isHalfDay: true },
        punch: { loginAt: '10:00', logoutAt: '14:30' },
      }),
    );
    assert.equal(d.status, 'Half day');
    assert.equal(d.activeHours, 4.5);
  });

  it('reports zeros for a day with no punch', () => {
    const d = attendanceOf(facts({ date: '2026-09-01' }));
    assert.equal(d.status, 'Absent');
    assert.equal(d.activeHours, 0);
    assert.equal(d.lateByMinutes, 0);
    assert.equal(d.loginAt, null);
  });
});

describe('the weekly chart', () => {
  const week: DayAttendance[] = [
    day('2026-08-31', 8),
    day('2026-09-01', 9),
    day('2026-09-02', 7.5),
    day('2026-09-03', 0),
    day('2026-09-04', 8.25),
    day('2026-09-05', 6),
    day('2026-09-06', 4),
  ];

  it('draws seven bars, oldest first', () => {
    const bars = weekBars(week, '2026-09-06');
    assert.equal(bars.length, 7);
    assert.equal(bars[0].date, '2026-08-31');
    assert.equal(bars[6].date, '2026-09-06');
  });

  it('keeps only the last seven when given more', () => {
    const long = [day('2026-08-24', 5), day('2026-08-25', 5), ...week];
    const bars = weekBars(long, '2026-09-06');
    assert.equal(bars.length, 7);
    assert.equal(bars[0].date, '2026-08-31');
  });

  it('sorts days that arrive out of order', () => {
    const bars = weekBars([...week].reverse(), '2026-09-06');
    assert.equal(bars[0].date, '2026-08-31');
  });

  it('marks today', () => {
    const bars = weekBars(week, '2026-09-06');
    assert.equal(bars.filter((b) => b.isToday).length, 1);
    assert.equal(bars[6].isToday, true);
  });

  it('scales against the longest day when it exceeds the floor', () => {
    const bars = weekBars(week, '2026-09-06');
    // longest is 9, which is also the floor
    assert.equal(bars[1].percent, 100);
    assert.equal(bars[0].percent, 89); // 8 / 9
  });

  it('holds the nine-hour floor so a light week does not read as a full one', () => {
    // Longest day is 4 hours. Without the floor it would draw at 100%.
    const light = [day('2026-09-01', 4), day('2026-09-02', 2)];
    const bars = weekBars(light, '2026-09-02');
    assert.equal(bars[0].percent, 44); // 4 / 9
    assert.equal(bars[1].percent, 22); // 2 / 9
  });

  it('draws a zero-hour day flat rather than dropping it', () => {
    const bars = weekBars(week, '2026-09-06');
    const off = bars.find((b) => b.date === '2026-09-03');
    assert.equal(off?.percent, 0);
    assert.equal(off?.hours, 0);
  });

  it('survives an empty week', () => {
    assert.deepEqual(weekBars([], '2026-09-06'), []);
  });
});

describe('walking dates', () => {
  it('lists every day in the range, inclusive of both ends', () => {
    assert.deepEqual(eachDate('2026-09-01', '2026-09-04'), [
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
    ]);
  });

  it('returns the single day when both ends match', () => {
    assert.deepEqual(eachDate('2026-09-01', '2026-09-01'), ['2026-09-01']);
  });

  it('returns nothing for a reversed range rather than looping', () => {
    assert.deepEqual(eachDate('2026-09-04', '2026-09-01'), []);
  });

  it('crosses a month boundary', () => {
    assert.deepEqual(eachDate('2026-08-30', '2026-09-02'), [
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ]);
  });

  it('crosses a year boundary', () => {
    assert.deepEqual(eachDate('2026-12-31', '2027-01-01'), ['2026-12-31', '2027-01-01']);
  });

  it('handles a leap day', () => {
    assert.deepEqual(eachDate('2028-02-28', '2028-03-01'), [
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ]);
  });

  it('is bounded, so a wild range cannot spin', () => {
    assert.equal(eachDate('2020-01-01', '2030-01-01').length, 400);
  });

  it('gives the seven days ending today, oldest first', () => {
    const days = lastDays('2026-09-06', 7);
    assert.equal(days.length, 7);
    assert.equal(days[0], '2026-08-31');
    assert.equal(days[6], '2026-09-06');
  });

  it('gives just today for a count of one', () => {
    assert.deepEqual(lastDays('2026-09-06', 1), ['2026-09-06']);
  });
});

describe('shifts that cross midnight', () => {
  it('recognises a night shift from its start and end', () => {
    assert.equal(crossesMidnight('23:00', '07:00'), true);
    assert.equal(crossesMidnight('18:00', '03:00'), true);
    assert.equal(crossesMidnight('10:00', '19:00'), false);
    // A shift that starts and ends at the same time is 24 hours, not zero —
    // but it is certainly not a same-day shift.
    assert.equal(crossesMidnight('09:00', '09:00'), true);
  });

  it('counts lateness forward around the clock', () => {
    // The case that silently read as On time before: 90 minutes into a 23:00
    // shift, on the wrong side of midnight.
    assert.equal(minutesLate('00:30', '23:00'), 90);
    assert.equal(minutesLate('23:05', '23:00'), 5);
    assert.equal(minutesLate('01:00', '23:00'), 120);
  });

  it('still treats arriving early as zero on a night shift', () => {
    assert.equal(minutesLate('22:50', '23:00'), 0);
    assert.equal(minutesLate('22:00', '23:00'), 0);
  });

  it('leaves day shifts exactly as they were', () => {
    assert.equal(minutesLate('10:20', '10:00'), 20);
    assert.equal(minutesLate('09:30', '10:00'), 0);
    assert.equal(minutesLate('10:00', '10:00'), 0);
  });

  it('files a night punch against the day the shift started', () => {
    const START = '23:00';
    const END = '07:00';
    // Clocking on at 23:30 on the 7th — tonight's shift, filed on the 7th.
    assert.equal(shiftDateOf('2026-09-07', '23:30', START, END), '2026-09-07');
    // Clocking off at 07:00 on the 8th — still the 7th's shift.
    assert.equal(shiftDateOf('2026-09-08', '07:00', START, END), '2026-09-07');
    // Arriving late at 00:30 on the 8th — joining the 7th's shift, not tonight's.
    assert.equal(shiftDateOf('2026-09-08', '00:30', START, END), '2026-09-07');
  });

  it('files a day punch against its own date, untouched', () => {
    assert.equal(shiftDateOf('2026-09-07', '10:05', '10:00', '19:00'), '2026-09-07');
    assert.equal(shiftDateOf('2026-09-07', '18:55', '10:00', '19:00'), '2026-09-07');
  });

  it('crosses a month boundary when the night does', () => {
    assert.equal(shiftDateOf('2026-10-01', '02:00', '23:00', '07:00'), '2026-09-30');
  });

  it('resolves a whole night shift end to end', () => {
    // 23:10 to 07:05 on a 23:00-07:00 roster: 10 minutes late, 7h 55m worked.
    const d = attendanceOf({
      date: '2026-09-07',
      today: '2026-09-08',
      weeklyOff: ['Sun'],
      holidayName: null,
      leave: null,
      punch: { loginAt: '23:10', logoutAt: '07:05' },
      shiftStart: '23:00',
      lateGraceMinutes: 15,
    });
    assert.equal(d.status, 'On time'); // 10 minutes is inside the grace window
    assert.equal(d.lateByMinutes, 10);
    assert.equal(d.activeHours, 7.92);
  });

  it('marks a night worker late when they miss the grace window', () => {
    const d = attendanceOf({
      date: '2026-09-07',
      today: '2026-09-08',
      weeklyOff: ['Sun'],
      holidayName: null,
      leave: null,
      punch: { loginAt: '00:30', logoutAt: '07:00' },
      shiftStart: '23:00',
      lateGraceMinutes: 15,
    });
    assert.equal(d.status, 'Late');
    assert.equal(d.lateByMinutes, 90);
    assert.equal(d.activeHours, 6.5);
  });
});
