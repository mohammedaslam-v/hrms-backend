import {
  AdminPanelNow,
  LatestPresenceRow,
  PageRef,
  PresencePerson,
  PresenceRow,
  PresenceStatus,
  PresenceSummary,
} from './presence.model';

/*
 * A copy of the new admin's rules (admin-backend src/presence/presence.service.ts).
 * HRMS shows the same list, so the windows and page names must match it. If
 * the admin panel changes them, change them here too.
 */

/** Seen within this many seconds = "online now" (the panel pings every 60 s). */
export const ONLINE_WINDOW_SECONDS = 180;
/** The "recently" list covers the last hour. */
export const RECENT_WINDOW_SECONDS = 3600;

// The admin panel's page catalogue (admin-backend page-catalogue.ts ADMIN_PAGES)
// plus the addresses that are not sidebar pages. A page added there and not
// here still shows its person and status — just without "on <page>".
const ADMIN_PAGE_NAMES: Array<[string, string]> = [
  ['/dashboard', 'Dashboard'],
  ['/admin', 'Admin Management'],
  ['/class-schedule-booking', 'Class Schedule'],
  ['/schedule-flow', 'Schedule Flow'],
  ['/add-batch', 'Add Batch'],
  ['/demo-holidays', 'Demo Holidays'],
  ['/customer-support', 'Customer Support'],
  ['/tickets', 'All Tickets'],
  ['/tickets/create', 'Create Ticket'],
  ['/parent-merge', 'Parent Merge'],
  ['/child-merge', 'Child Merge'],
  ['/parent-app-analytics', 'Parent App Analytics'],
  ['/booking-sales', 'Booking-Sales'],
  ['/csr-assignment', 'CSR Assignment'],
  ['/presales-assignment', 'Presales Assignment'],
  ['/cold-calling', 'Cold Calling'],
  ['/online-campaigns', 'Online Campaigns'],
  ['/classads', 'Class Ads'],
  ['/landing-pages', 'Landing Pages'],
  ['/faculty-details', 'Faculty'],
  ['/teacher-payout', 'Teacher Payout'],
  ['/faculty-schemes', 'Faculty Schemes'],
  ['/daily-class-dashboard', 'Daily Class Dashboard'],
  ['/free-available-hours', 'Free Available Hours'],
  ['/recording', 'Recordings'],
  ['/classes', 'Classes'],
  ['/group-classes', 'Group Classes'],
  ['/curriculums', 'Curriculums'],
  ['/demo-flow', 'Demo Flow'],
  ['/certificates', 'Certificates'],
  ['/invoices', 'Invoices'],
  ['/price-packages', 'Price Packages'],
  ['/notifications', 'Notifications'],
];

const EXTRA_PAGE_NAMES: Array<[string, string]> = [
  ['/profile', 'My Profile'],
  ['/tickets/show', 'Ticket'],
  ['/tickets/create', 'Create Ticket'],
  ['/add-batch', 'Add Batch'],
  ['/classes', 'Classes'],
  ['/batch-insights', 'Batch Insights'],
  ['/cold-calling', 'Cold Calling'],
  ['/classads', 'Class Ads'],
  ['/sql-console', 'SQL Console'],
];

// Longest-prefix match, so /price-packages/12 reads as "Price Packages".
const PAGE_NAMES: Array<[string, string]> = [...ADMIN_PAGE_NAMES, ...EXTRA_PAGE_NAMES].sort(
  (a, b) => b[0].length - a[0].length,
);

export function pageNameFor(path: string | null): string | null {
  if (!path) return null;
  for (const [prefix, name] of PAGE_NAMES) {
    if (path === prefix || path.startsWith(prefix + '/')) return name;
  }
  return null;
}

export const statusOf = (r: PresenceRow): PresenceStatus =>
  r.signed_off ? 'signed_off' : r.seconds_ago <= ONLINE_WINDOW_SECONDS ? 'online' : 'away';

// ── Other Bambinos panels ─────────────────────────────────────────────────────
//
// Every panel loads one shared script (presence.tracker-script.ts) that pings
// /tracker/collect. The panel is named by the script tag's data-panel, or else
// by the site's first subdomain (renewals.bambinos.live → "renewals").

/** The admin panel's own pings carry no panel; this is what they read as. */
export const ADMIN_PANEL = 'admin';

/** Display names for the panels we know. Anything else is title-cased. */
const PANEL_NAMES: Record<string, string> = {
  admin: 'Admin panel',
  renewal: 'Renewal panel',
  renewals: 'Renewal panel',
  crm: 'CRM',
  faculty: 'Faculty panel',
  parent: 'Parent panel',
  hrms: 'HRMS',
  ops: 'Ops panel',
  demo: 'Demo panel',
};

export function panelNameFor(panel: string | null | undefined): string {
  const key = panel || ADMIN_PANEL;
  if (PANEL_NAMES[key]) return PANEL_NAMES[key];
  const words = key.replace(/[-_]+/g, ' ').trim();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} panel`;
}

/** "/renewal-analysis/42" → "Renewal analysis". Used when a panel sent no title. */
function nameFromPath(path: string | null): string | null {
  if (!path) return null;
  const parts = path.split('/').filter((p) => p && !/^\d+$/.test(p) && !/^[0-9a-f-]{16,}$/i.test(p));
  const last = parts[parts.length - 1];
  if (!last) return null;
  const words = decodeURIComponent(last).replace(/[-_]+/g, ' ').trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : null;
}

/** Where someone is, for any panel: the admin panel names its own pages. */
export function pageRefFor(path: string | null, panel?: string | null, title?: string | null): PageRef {
  const key = panel || ADMIN_PANEL;
  const name = key === ADMIN_PANEL ? pageNameFor(path) : title || nameFromPath(path);
  return { path, name, panel: key, panelName: panelNameFor(key) };
}

/** Sites allowed to report: any https *.bambinos.live, and localhost for testing. */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  return /^https:\/\/([a-z0-9-]+\.)*bambinos\.live$/i.test(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

/** "https://renewals.bambinos.live" → "renewals"; "https://bambinos.live" → "site". */
export function panelFromOrigin(origin: string): string {
  const host = origin.replace(/^https?:\/\//, '').split(':')[0].toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return 'local';
  const parts = host.split('.');
  return parts.length > 2 ? parts[0] : 'site';
}

/** What a panel may tell us, after cleaning. */
export interface TrackerPing {
  event: 'ping' | 'signoff';
  panel: string;
  adminId: number | null;
  email: string | null;
  path: string | null;
  title: string | null;
}

/**
 * Cleans one report from the shared script, or null when it cannot be used.
 * Pure, so the rules are tested without a server: only a path (never a query
 * string — those can carry parents' phone numbers), a short title, a known
 * event, and someone to attribute it to.
 */
export function parseTrackerPing(raw: unknown, origin: string): TrackerPing | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;

  const event = b.event === 'signoff' ? 'signoff' : b.event === 'ping' ? 'ping' : null;
  if (!event) return null;

  const id = Number(b.adminId);
  const adminId = Number.isInteger(id) && id > 0 ? id : null;
  const email =
    typeof b.email === 'string' && /^[^\s@]{1,64}@[^\s@]{1,190}$/.test(b.email.trim())
      ? b.email.trim().toLowerCase()
      : null;
  if (!adminId && !email) return null;

  const named = typeof b.panel === 'string' ? b.panel.trim().toLowerCase() : '';
  const panel = /^[a-z0-9][a-z0-9_-]{0,31}$/.test(named) ? named : panelFromOrigin(origin);
  // The admin panel reports through its own heartbeat; a script claiming to be
  // it from elsewhere would only blur where people really are.
  if (panel === ADMIN_PANEL) return null;

  const path = cleanTrackerPath(b.path);
  const title =
    typeof b.title === 'string' && b.title.trim() ? b.title.replace(/\s+/g, ' ').trim().slice(0, 120) : null;

  return { event, panel, adminId, email, path, title };
}

/** A clean path: no query string or fragment query, at most 191 characters. */
function cleanTrackerPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const path = raw.split('?')[0].trim();
  if (!path.startsWith('/') || path.length > 191) return null;
  return path;
}

export const toPerson = (r: PresenceRow): PresencePerson => ({
  admin_id: r.admin_id,
  name: r.name,
  role: r.role,
  status: statusOf(r),
  seconds_ago: r.seconds_ago,
  session_minutes: r.session_minutes,
  page: pageRefFor(r.last_path, r.last_panel, r.last_title),
});

/** Rows (newest first) to the summary the header renders. */
export function summarise(rows: PresenceRow[], now: Date = new Date()): PresenceSummary {
  const people = rows.map(toPerson);
  const online = people.filter((p) => p.status === 'online');
  const recent = people.filter((p) => p.status !== 'online');
  return {
    online,
    recent,
    counts: { online: online.length, last_hour: people.length },
    generated_at: now.toISOString(),
  };
}

/** The latest row as "now": the same status rule as the list. */
export function nowFrom(r: LatestPresenceRow): AdminPanelNow {
  const [lastSeenDate, lastSeenTime] = r.last_seen_ist.split(' ');
  return {
    status: r.signed_off ? 'signed_off' : r.seconds_ago <= ONLINE_WINDOW_SECONDS ? 'online' : 'away',
    secondsAgo: r.seconds_ago,
    sessionMinutes: r.session_minutes,
    page: pageRefFor(r.last_path, r.last_panel, r.last_title),
    lastSeenDate,
    lastSeenTime,
  };
}

/** Longest range My Page may ask for at once. */
export const MAX_ACTIVITY_RANGE_DAYS = 31;
