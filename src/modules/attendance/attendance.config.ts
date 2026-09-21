/**
 * ════════════════════════════════════════════════════════════════════════════
 *  THE ONE PLACE TO CHANGE WHO IS MEASURED BY ACTIVITY
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Add a role to the list below and nothing else needs to change. No migration,
 * no other file, no data to backfill — the next request picks it up.
 *
 * The values are `admins.role` or designation as written by the admin portals:
 *
 *     'Admin', 'SuperAdmin', 'CSR', 'RegionalAdmin', 'ESM_CSM', 'SSM',
 *     'Teacher Ops', 'HR', 'Tech', 'Lead', 'TSM'
 *
 * WHAT THIS DOES AND DOES NOT AFFECT
 *
 *   AFFECTS      the "Active hours · this week" chart, and the day range behind
 *                it. For these roles a day's hours come from the half-hour slots
 *                the admin portals observed.
 *
 *   DOES NOT     check-in and check-out. Every employee keeps both buttons and
 *                both endpoints, whatever their role. The Today card always
 *                shows what the person declared by punching.
 *
 * So this list changes where ONE number comes from. It never takes an option
 * away from anybody.
 */

export const ACTIVITY_MEASURED_ROLES: readonly string[] = [
  'Admin',
  'SuperAdmin',
  'CSR',
  'RegionalAdmin',
  'ESM_CSM',
  'SSM',
  'Teacher Ops',
  'HR',
  'Tech',
  'Lead',
  'TSM',
];

/**
 * Is this person's week measured from portal activity?
 *
 * Compared case-insensitively so that a role typed as 'csr' in the list, or
 * stored as 'Csr' by the portal, still matches. A silent miss here would show
 * somebody an empty chart with no error to explain it.
 *
 * A null role falls through to check-in and check-out, which is the safe default.
 */
export const isActivityMeasured = (
  portalRole: string | null,
  designation?: string | null,
): boolean => {
  const match = (val: string | null | undefined) =>
    Boolean(val) &&
    ACTIVITY_MEASURED_ROLES.some((role) => role.toLowerCase() === val!.trim().toLowerCase());

  return match(portalRole) || match(designation);
};
