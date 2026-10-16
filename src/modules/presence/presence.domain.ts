import { PresencePerson, PresenceRow, PresenceStatus, PresenceSummary } from './presence.model';

/*
 * A copy of the new admin's rules (admin-backend src/presence/presence.service.ts).
 * HRMS shows the same list, so the windows and page names must match it. If
 * the admin panel changes them, change them here too.
 */

/**
 * Who may see the pill for now, by `hrms_employees.admin_id`. A pilot: everyone
 * else gets a 403 and no pill. Remove the check in PresenceService to open it
 * to everyone.
 */
export const PRESENCE_PILOT_ADMIN_IDS: readonly number[] = [327, 1262];

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

export const toPerson = (r: PresenceRow): PresencePerson => ({
  admin_id: r.admin_id,
  name: r.name,
  role: r.role,
  status: statusOf(r),
  seconds_ago: r.seconds_ago,
  session_minutes: r.session_minutes,
  page: { path: r.last_path, name: pageNameFor(r.last_path) },
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
