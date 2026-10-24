import { nowFrom } from './presence.domain';

import { addDays, crossesMidnight, isWeeklyOff, minutesOf } from '../attendance/attendance.domain';
import {
  BoardGroup,
  BoardPerson,
  BoardPresence,
  LatestPresenceRow,
  PresenceBoard,
  UnlinkedPresenceRow,
} from './presence.model';

/** One person in scope, as the board needs them. */
export interface BoardMember {
  employeeId: number;
  name: string;
  designation: string | null;
  department: string | null;
  shiftStart: string;
  shiftEnd: string;
}

export interface BoardInput {
  today: string;
  viewerId: number;
  viewerAdminIds: number[];
  members: BoardMember[];
  adminOf: Map<number, number>;
  /** admins.role by admin id. */
  roleOf: Map<number, string>;
  latest: Map<number, LatestPresenceRow>;
  leaveOf: Map<number, { type: string; isHalfDay: boolean }>;
  /** Admin-panel users with no HRMS record, seen in the last 30 days. */
  unlinked: UnlinkedPresenceRow[];
  now?: Date;
  /** The database's HH:MM. Without it nobody is on duty — only the active show. */
  time?: string;
  /** Weekly off day names by employee id. */
  weeklyOffOf?: Map<number, string[]>;
  /** Today's declared holiday, if any. */
  holidayToday?: string | null;
  /** Seconds active on the admin panel today (India date), by admin id. */
  activeSecondsOf?: Map<number, number>;
}

export const NO_RECORD_GROUP = 'No HRMS record';

const DAY_MINUTES = 24 * 60;

/**
 * Is a shift running at `time`, and if so which date does it belong to?
 *
 * A shift that crosses midnight belongs to the day it started — the same rule
 * attendance uses — so at 02:00 a 22:00–06:00 person is on YESTERDAY's shift,
 * and it is yesterday's weekly off that decides whether they are expected.
 * The end minute is outside: a 10:00–19:00 shift is over at 19:00.
 */
export function shiftNow(
  shiftStart: string,
  shiftEnd: string,
  today: string,
  time: string,
): { shiftDate: string; minutesIn: number } | null {
  const start = minutesOf(shiftStart);
  const end = minutesOf(shiftEnd);
  const now = minutesOf(time);

  if (!crossesMidnight(shiftStart, shiftEnd)) {
    return now >= start && now < end ? { shiftDate: today, minutesIn: now - start } : null;
  }
  if (now >= start) return { shiftDate: today, minutesIn: now - start };
  if (now < end) return { shiftDate: addDays(today, -1), minutesIn: now + DAY_MINUTES - start };
  return null;
}

const hm = (t: string): string => t.slice(0, 5);

const presenceOf = (row: LatestPresenceRow | undefined): BoardPresence | null =>
  row ? nowFrom(row) : null;

// Online first, then the most recently seen, then never seen; by name last.
const RANK = { online: 0, away: 1, signed_off: 1 } as const;
const byActivity = (a: BoardPerson, b: BoardPerson): number => {
  const ra = a.presence ? RANK[a.presence.status] : 2;
  const rb = b.presence ? RANK[b.presence.status] : 2;
  if (ra !== rb) return ra - rb;
  if (a.presence && b.presence && a.presence.secondsAgo !== b.presence.secondsAgo) {
    return a.presence.secondsAgo - b.presence.secondsAgo;
  }
  return a.name.localeCompare(b.name);
};

/**
 * Everyone in scope, grouped by shift (earliest start first), each group
 * sorted by activity, with the no-record admins last. Pure, so it is tested
 * without a database.
 */
export function buildBoard(input: BoardInput): PresenceBoard {
  const groups = new Map<string, BoardGroup>();

  for (const m of input.members) {
    const start = hm(m.shiftStart);
    const end = hm(m.shiftEnd);
    const key = `${start}–${end}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, label: key, shiftStart: start, people: [], online: 0 };
      groups.set(key, group);
    }
    const adminId = input.adminOf.get(m.employeeId) ?? null;
    const presence = presenceOf(adminId ? input.latest.get(adminId) : undefined);
    const leave = input.leaveOf.get(m.employeeId) ?? null;

    // Off is judged against the shift running now (or today's, outside it).
    const running = input.time ? shiftNow(m.shiftStart, m.shiftEnd, input.today, input.time) : null;
    const shiftDate = running?.shiftDate ?? input.today;
    const dayOff = isWeeklyOff(shiftDate, input.weeklyOffOf?.get(m.employeeId) ?? [])
      ? 'Weekly off'
      : input.holidayToday
        ? 'Holiday'
        : null;

    group.people.push({
      employeeId: m.employeeId,
      adminId,
      name: m.name,
      subtitle: m.designation,
      team: (adminId ? input.roleOf.get(adminId) : undefined) || m.department || null,
      leave,
      dayOff,
      // Any leave, half day included, takes someone off the expected list;
      // they still appear on the Active tab whenever they are active.
      onDuty: Boolean(running) && !dayOff && !leave,
      shiftMinutesIn: running?.minutesIn ?? null,
      activeTodaySeconds: adminId ? (input.activeSecondsOf?.get(adminId) ?? 0) : 0,
      presence,
      // By employee from HRMS; by admin account from the admin panel.
      isMe: m.employeeId === input.viewerId || (adminId !== null && input.viewerAdminIds.includes(adminId)),
    });
  }

  const ordered = [...groups.values()].sort(
    (a, b) => (a.shiftStart ?? '').localeCompare(b.shiftStart ?? '') || a.key.localeCompare(b.key),
  );

  if (input.unlinked.length > 0) {
    ordered.push({
      key: NO_RECORD_GROUP,
      label: NO_RECORD_GROUP,
      shiftStart: null,
      online: 0,
      people: input.unlinked.map((u) => ({
        employeeId: null,
        adminId: u.admin_id,
        name: u.name,
        subtitle: u.role || null,
        team: u.role || null,
        leave: null,
        // No HRMS record means no shift: shown only while active.
        dayOff: null,
        onDuty: false,
        shiftMinutesIn: null,
        activeTodaySeconds: input.activeSecondsOf?.get(u.admin_id) ?? 0,
        presence: nowFrom(u),
        isMe: input.viewerAdminIds.includes(u.admin_id),
      })),
    });
  }

  let online = 0;
  let people = 0;
  for (const g of ordered) {
    g.people.sort(byActivity);
    g.online = g.people.filter((p) => p.presence?.status === 'online').length;
    online += g.online;
    people += g.people.length;
  }

  return {
    today: input.today,
    groups: ordered,
    counts: { online, people },
    generatedAt: (input.now ?? new Date()).toISOString(),
  };
}
