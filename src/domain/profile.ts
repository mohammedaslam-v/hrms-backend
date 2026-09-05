/**
 * Who may open whose profile, and how much of it they see.
 *
 * Pure functions, no database. The reporting-tree lookup is passed in as an
 * already-answered boolean so these rules can be read — and tested — without a
 * connection, and so the rule itself lives in one place rather than being
 * re-derived by every caller.
 */

import { AccessTier } from '../models/auth.model';

export type ProfileAccess = 'self' | 'manager' | 'admin' | 'denied';

export interface ProfileViewerFacts {
  viewerId: number;
  subjectId: number;
  tiers: AccessTier[];
  /** Whether the subject sits anywhere below the viewer in the reporting tree. */
  isReport: boolean;
}

/**
 * Resolved in order, most specific first. Your own profile is always your own,
 * even if you are also an admin — so the reason you are seeing pay is recorded
 * as `self` rather than `admin`, which is what an audit line should say.
 */
export function resolveProfileAccess(facts: ProfileViewerFacts): ProfileAccess {
  if (facts.viewerId === facts.subjectId) return 'self';
  if (facts.tiers.includes('admin')) return 'admin';
  if (facts.isReport) return 'manager';
  return 'denied';
}

/**
 * Pay is between the employee, HR and the founder — the rule the developer
 * guide states, and the reason a manager's view of a report omits the
 * compensation figures rather than hiding them in the browser.
 */
export const canSeeCompensation = (access: ProfileAccess): boolean =>
  access === 'self' || access === 'admin';

/**
 * Date of birth, personal email, emergency contact and the onboarding documents
 * — Aadhaar and PAN among them. Identity data the job does not require, so a
 * manager viewing a report does not receive it.
 *
 * This is the safe default while HR decides. If they rule that a manager should
 * see a report's documents, this is the one line that changes.
 */
export const canSeePersonalDetails = (access: ProfileAccess): boolean =>
  access === 'self' || access === 'admin';

/**
 * A note marked `managers_only` is written about someone, not for them. The
 * subject never sees it, however senior they are.
 */
export const canSeeRestrictedFeedback = (access: ProfileAccess): boolean =>
  access === 'manager' || access === 'admin';
