import { ApiError } from '../../utils/api-error';
import { addDays } from '../../shared/dates';
import { CreateWorkActivityDto, WorkActivityType } from './work-activity.model';

export const WORK_ACTIVITY_TYPES: readonly WorkActivityType[] = ['phone_call', 'external_meeting', 'other'];

/** Today and the two days before it — enough for a late call or a forgotten meeting. */
export const EDITABLE_DAYS = 3;

export const NOTE_MAX = 500;

/** The dates an activity may be recorded for, newest first. */
export const editableDates = (today: string): string[] =>
  Array.from({ length: EDITABLE_DAYS }, (_, i) => addDays(today, -i));

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMinutes = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/**
 * Validates a new activity against the rules and the current moment.
 * Returns the cleaned record; throws a 400 naming what is wrong.
 */
export function validateActivity(
  raw: Partial<Record<keyof CreateWorkActivityDto, unknown>>,
  now: { date: string; time: string },
): CreateWorkActivityDto {
  const date = typeof raw.date === 'string' ? raw.date : '';
  if (!editableDates(now.date).includes(date)) {
    throw ApiError.badRequest('Activities can be recorded for today and the two days before only.');
  }

  const type = raw.type as WorkActivityType;
  if (!WORK_ACTIVITY_TYPES.includes(type)) {
    throw ApiError.badRequest('Choose phone call, external meeting or other.');
  }

  const startTime = typeof raw.startTime === 'string' ? raw.startTime.slice(0, 5) : '';
  const endTime = typeof raw.endTime === 'string' ? raw.endTime.slice(0, 5) : '';
  if (!TIME.test(startTime) || !TIME.test(endTime)) {
    throw ApiError.badRequest('Start and end must be times (HH:MM).');
  }
  if (toMinutes(endTime) <= toMinutes(startTime)) {
    throw ApiError.badRequest('The end time must be after the start time, on the same day.');
  }
  if (date === now.date && toMinutes(endTime) > toMinutes(now.time.slice(0, 5))) {
    throw ApiError.badRequest('An activity cannot end later than now.');
  }

  const note = typeof raw.note === 'string' ? raw.note.trim() : '';
  if (type === 'other' && !note) {
    throw ApiError.badRequest('Add a short note saying what the activity was.');
  }
  if (note.length > NOTE_MAX) {
    throw ApiError.badRequest(`The note must be ${NOTE_MAX} characters or fewer — you have ${note.length}.`);
  }

  return { date, type, startTime, endTime, note: note || null };
}

// ── Merging recorded activities into a day's active time ─────────────────────
// The same rule the week chart's hover box uses (frontend activity-hours.ts):
// time is counted once however many records cover it.

export interface Span {
  from: string;
  /** Null while still checked in — read as `now`. */
  to: string | null;
}

/** [start, end) in minutes; a span that wraps past midnight is cut at 24:00. */
const toRange = (s: Span, now: string): [number, number] => {
  const start = toMinutes(s.from.slice(0, 5));
  const end = toMinutes((s.to ?? now).slice(0, 5));
  return [start, end >= start ? end : 24 * 60];
};

/** Total minutes covered by the spans, overlaps counted once. */
export function coveredMinutes(spans: Span[], now: string): number {
  const ranges = spans.map((s) => toRange(s, now)).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const [start, end] of ranges) {
    if (start > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = start;
      curEnd = end;
    } else if (end > curEnd) {
      curEnd = end;
    }
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return total;
}

/** Minutes the activities add on top of the check-in time. */
export function addedMinutes(punches: Span[], activities: Span[], now: string): number {
  if (activities.length === 0) return 0;
  return Math.max(0, coveredMinutes([...punches, ...activities], now) - coveredMinutes(punches, now));
}
