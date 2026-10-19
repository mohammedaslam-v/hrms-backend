import { nowFrom } from './presence.domain';
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
  /** Admins only; empty for everyone else. */
  unlinked: UnlinkedPresenceRow[];
  now?: Date;
}

export const NO_RECORD_GROUP = 'No HRMS record';

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
    group.people.push({
      employeeId: m.employeeId,
      adminId,
      name: m.name,
      subtitle: m.designation,
      team: (adminId ? input.roleOf.get(adminId) : undefined) || m.department || null,
      leave: input.leaveOf.get(m.employeeId) ?? null,
      presence,
      isMe: m.employeeId === input.viewerId,
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
