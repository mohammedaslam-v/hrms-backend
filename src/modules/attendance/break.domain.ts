/**
 * Breaks — one hour a shift, taken inside the shift, started and ended by the
 * person on the same device.
 *
 * Pure: no database, no HTTP, no clock. Every time arrives as a
 * 'YYYY-MM-DD HH:MM' string from the database clock.
 *
 * THE RULES (HR, 19 Nov 2026)
 *
 *   1. One hour in total per shift, in as many pieces as they like.
 *   2. Only while checked in, and only inside the shift's hours.
 *   3. One break at a time.
 *   4. A break is ended on the SAME DEVICE it was started on. Starting on the
 *      office laptop and ending from a phone outside is the case this stops.
 *   5. A fenced person ends it in the same place they started it (office stays
 *      office, home stays home). The phone-only case is caught here: the phone
 *      is outside the office circle, so the end is refused.
 *   6. A break nobody ends stops by itself when the hour runs out, or at the
 *      shift end if that comes first. Its end time is fixed when it starts
 *      (`endsBy`), so it is derived on read and needs no background job.
 *   7. Checking out ends a running break at the check-out time.
 *
 * WHAT IT CANNOT PROVE
 *
 *   The device id is a random value the browser keeps. Clearing the browser's
 *   data loses it: the break then cannot be ended by hand and stops at `endsBy`.
 *   That is the safe direction — the person loses break time, never gains it.
 */

import type { ZoneKind } from './geofence.domain';

export const BREAK_ALLOWANCE_MINUTES = 60;

export interface BreakRecord {
  id: number;
  /** 'YYYY-MM-DD HH:MM' */
  startedAt: string;
  /** Null while running (or until a stale one is tidied up). */
  endedAt: string | null;
  /** When it stops by itself. Fixed at the start. */
  endsBy: string;
  startDevice: string;
  startDeviceLabel: string | null;
  startZone: ZoneKind | null;
}

/** 'YYYY-MM-DD HH:MM[:SS]' as whole minutes since 1970, in its own wall clock. */
export function stamp(dateTime: string): number {
  const [d, t] = dateTime.split(' ');
  const [y, mo, day] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  return Date.UTC(y, mo - 1, day) / 60_000 + h * 60 + mi;
}

/** The inverse of stamp(): minutes back to 'YYYY-MM-DD HH:MM'. */
export function fromStamp(minutes: number): string {
  return new Date(minutes * 60_000).toISOString().slice(0, 16).replace('T', ' ');
}

/** Just the 'HH:MM' of a 'YYYY-MM-DD HH:MM'. */
export const clockOf = (dateTime: string): string => dateTime.slice(11, 16);

/**
 * The shift's start and end as date-times. A night shift (end at or before
 * start) ends on the next calendar day.
 */
export function shiftBounds(
  shiftDate: string,
  shiftStart: string,
  shiftEnd: string,
): { start: string; end: string } {
  const start = stamp(`${shiftDate} ${shiftStart}`);
  let end = stamp(`${shiftDate} ${shiftEnd}`);
  if (end <= start) end += 24 * 60;
  return { start: fromStamp(start), end: fromStamp(end) };
}

/** When a break really ended: its stored end, its `endsBy` once passed, or null while running. */
export function effectiveEnd(b: BreakRecord, now: string): string | null {
  if (b.endedAt) return b.endedAt;
  return stamp(now) >= stamp(b.endsBy) ? b.endsBy : null;
}

/** The break still running at `now`, if any. */
export const runningBreak = (breaks: BreakRecord[], now: string): BreakRecord | null =>
  breaks.find((b) => effectiveEnd(b, now) === null) ?? null;

/** Minutes used so far this shift, a running break counted up to now. */
export function usedMinutes(breaks: BreakRecord[], now: string): number {
  let total = 0;
  for (const b of breaks) {
    const end = effectiveEnd(b, now) ?? now;
    total += Math.max(0, stamp(end) - stamp(b.startedAt));
  }
  return total;
}

export type BreakVerdict = { ok: true; endsBy: string } | { ok: false; message: string };

/** May a break start now? On yes, when it will stop by itself. */
export function startVerdict(input: {
  checkedIn: boolean;
  now: string;
  shift: { start: string; end: string };
  breaks: BreakRecord[];
}): BreakVerdict {
  const { now, shift, breaks } = input;
  if (!input.checkedIn) return { ok: false, message: 'Check in first to start a break.' };

  const running = runningBreak(breaks, now);
  if (running) {
    return { ok: false, message: `You are already on a break since ${clockOf(running.startedAt)}.` };
  }

  const at = stamp(now);
  if (at < stamp(shift.start) || at >= stamp(shift.end)) {
    return {
      ok: false,
      message: `Breaks can only be taken within your shift (${clockOf(shift.start)}–${clockOf(shift.end)}).`,
    };
  }

  const remaining = BREAK_ALLOWANCE_MINUTES - usedMinutes(breaks, now);
  if (remaining <= 0) {
    return { ok: false, message: 'You have used your full 1 hour of break for this shift.' };
  }

  return { ok: true, endsBy: fromStamp(Math.min(at + remaining, stamp(shift.end))) };
}

const PLACE: Record<ZoneKind, string> = {
  office: 'the office',
  home: 'your home location',
  second: 'your second location',
};

/**
 * May this running break be ended from here, on this device?
 * `zone` is where the end is being made from (null when the person is not fenced).
 */
export function endVerdict(input: {
  running: BreakRecord | null;
  deviceId: string | null;
  zone: ZoneKind | null;
}): { ok: true } | { ok: false; message: string } {
  const { running, deviceId, zone } = input;
  if (!running) return { ok: false, message: 'You are not on a break.' };

  if (deviceId !== running.startDevice) {
    const on = running.startDeviceLabel ? ` (${running.startDeviceLabel})` : '';
    return {
      ok: false,
      message:
        `End your break on the same device you started it on${on}. ` +
        `If that device is not with you, the break ends by itself at ${clockOf(running.endsBy)}.`,
    };
  }

  if (running.startZone && zone && zone !== running.startZone) {
    return { ok: false, message: `You started your break at ${PLACE[running.startZone]}. End it there.` };
  }

  return { ok: true };
}

/** A random id the browser made: letters, digits and dashes, 8–64 long. */
export const isDeviceId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(value);

/** "Chrome on Windows", "Safari on iPhone" — so the refusal can name the device. */
export function deviceLabel(userAgent: string | undefined | null): string | null {
  if (!userAgent) return null;
  const ua = userAgent;
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? /Mobile/.test(ua)
          ? 'Android phone'
          : 'Android tablet'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\/|FxiOS/.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS/.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os;
}
