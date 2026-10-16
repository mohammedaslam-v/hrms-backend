/**
 * Who is on the new admin panel — the same list its header shows.
 *
 * The shape is the admin backend's (`GET /api/presence/online`) field for
 * field, so the two headers can be compared line by line and the frontend
 * component is a straight port.
 */
export type PresenceStatus = 'online' | 'away' | 'signed_off';

export interface PresencePerson {
  admin_id: number;
  name: string;
  role: string;
  status: PresenceStatus;
  seconds_ago: number;
  session_minutes: number;
  page: { path: string | null; name: string | null };
}

export interface PresenceSummary {
  /** Online now, most recent first. */
  online: PresencePerson[];
  /** Seen in the last hour but not online now (idle, closed the tab, or logged out). */
  recent: PresencePerson[];
  counts: { online: number; last_hour: number };
  generated_at: string;
  /** HRMS only: the viewer's own admin account(s), for the "(you)" marker. */
  viewer_admin_ids?: number[];
}

/** One `admin_panel_presence` row joined to its admin, ages computed by MySQL. */
export interface PresenceRow {
  admin_id: number;
  name: string;
  role: string;
  last_path: string | null;
  seconds_ago: number;
  session_minutes: number;
  /** 1 when the last thing they did was log out. */
  signed_off: number;
}
