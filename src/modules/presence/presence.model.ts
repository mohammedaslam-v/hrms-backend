/**
 * Who is on the new admin panel — the same list its header shows.
 *
 * The shape is the admin backend's (`GET /api/presence/online`) field for
 * field, so the two headers can be compared line by line and the frontend
 * component is a straight port.
 */
export type PresenceStatus = 'online' | 'away' | 'signed_off';

/**
 * Where someone is: which Bambinos panel, and which page on it.
 *
 * `panel` is a short key ('admin', 'renewals', 'crm', …); `panelName` is how
 * it reads ("Renewal panel"). `name` is the page's name when known — from the
 * admin panel's page catalogue, or the title another panel's tab reported.
 */
export interface PageRef {
  path: string | null;
  name: string | null;
  panel: string;
  panelName: string;
}

export interface PresencePerson {
  admin_id: number;
  name: string;
  role: string;
  status: PresenceStatus;
  seconds_ago: number;
  session_minutes: number;
  page: PageRef;
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
  /** Which panel the last ping came from; null/absent = the admin panel. */
  last_panel?: string | null;
  /** The page title another panel reported, when it sent one. */
  last_title?: string | null;
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
  page: PageRef;
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
  /** Which panel the last ping came from; null/absent = the admin panel. */
  last_panel?: string | null;
  /** The page title another panel reported, when it sent one. */
  last_title?: string | null;
  seconds_ago: number;
  session_minutes: number;
  signed_off: number;
  last_seen_ist: string;
}

// ── The shift-wise board (header dropdown) ───────────────────────────────────

/** The admin-panel side of a board row. Null when never seen on the panel. */
export interface BoardPresence {
  status: PresenceStatus;
  secondsAgo: number;
  sessionMinutes: number;
  page: PageRef;
  /** India date and HH:MM of the last ping. */
  lastSeenDate: string;
  lastSeenTime: string;
}

export interface BoardPerson {
  /** Null for an admin-panel user with no HRMS record. */
  employeeId: number | null;
  adminId: number | null;
  name: string;
  /** Designation for an employee; the admin role for someone with no record. */
  subtitle: string | null;
  /**
   * The grey label beside the name: the admin-panel role (admins.role, as the
   * new admin shows it), or the HRMS department for someone with no account.
   */
  team: string | null;
  /** Shift start time (HH:MM), or null for unlinked accounts. */
  shiftStart: string | null;
  /** Approved leave today. Shown instead of the online status. */
  leave: { type: string; isHalfDay: boolean } | null;
  /** 'Weekly off' or 'Holiday' for the shift day running now, else null. */
  dayOff: string | null;
  /**
   * Supposed to be working at this moment: inside their shift hours, and not
   * on a weekly off, holiday or any leave that day. The Active tab lists these
   * people plus anyone active right now.
   */
  onDuty: boolean;
  /** Minutes since the running shift began, while inside it; else null. */
  shiftMinutesIn: number | null;
  /** Total time active on the admin panel today (India date), in seconds. */
  activeTodaySeconds: number;
  presence: BoardPresence | null;
  isMe: boolean;
}

export interface BoardGroup {
  /** "10:00–19:00", or "No HRMS record". */
  key: string;
  label: string;
  /** Null for the no-record group. */
  shiftStart: string | null;
  people: BoardPerson[];
  online: number;
}

export interface PresenceBoard {
  /** India date — the frontend words "yesterday 18:40" against it. */
  today: string;
  groups: BoardGroup[];
  counts: { online: number; people: number };
  generatedAt: string;
}

/** What the closed pill needs: one number. */
export interface PresenceCount {
  online: number;
}

/** A latest-presence row for several admins at once. */
export interface LatestPresenceForAdmin extends LatestPresenceRow {
  admin_id: number;
}

/** An admin-panel user with no HRMS record, for the "No HRMS record" group. */
export interface UnlinkedPresenceRow extends LatestPresenceForAdmin {
  name: string;
  role: string;
}
