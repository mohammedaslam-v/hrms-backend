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

/** One India date on the admin panel, from `admin_panel_presence_day`. */
export interface AdminPanelDay {
  date: string;
  /** HH:MM, India time. */
  firstSeen: string;
  lastSeen: string;
  activeSeconds: number;
  /** Visits that day: a gap of more than 10 minutes starts a new one. */
  sessions: number;
}

/** Where the person is on the admin panel now, or when they were last there. */
export interface AdminPanelNow {
  status: PresenceStatus;
  secondsAgo: number;
  sessionMinutes: number;
  page: { path: string | null; name: string | null };
  /** India date and HH:MM of the last ping. */
  lastSeenDate: string;
  lastSeenTime: string;
}

/** The admin-panel side of My Page's week chart. */
export interface AdminPanelActivity {
  /** False when the employee has no admin account, so nothing can be recorded. */
  linked: boolean;
  days: AdminPanelDay[];
  /** Null when they have never been on the new admin panel. */
  now: AdminPanelNow | null;
}

/** The latest `admin_panel_presence` row, ages computed by MySQL. */
export interface LatestPresenceRow {
  last_path: string | null;
  seconds_ago: number;
  session_minutes: number;
  signed_off: number;
  last_seen_ist: string;
}
