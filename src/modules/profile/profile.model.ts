/**
 * My page — the employee's own profile, and the profile a manager opens for
 * someone in their reporting line.
 *
 * The record here is the raw read. Nothing on it is gated: deciding what a
 * particular viewer may see (pay, restricted feedback) is the service's job, so
 * that a single rule governs it rather than each caller remembering.
 */

import { FeedbackRecord } from '../feedback/feedback.model';
import { GoalView } from '../goals/goals.model';
import { ProjectRecord } from '../projects/projects.model';

export type WorkMode = 'WFH' | 'WFO' | 'Hybrid';

/**
 * A file uploaded during onboarding through the Bambinos admin portal.
 *
 * `path` is what `admins` stores. It is never handed to the browser as-is — the
 * download endpoint re-checks the viewer and streams the file.
 */
export interface ProfileDocument {
  key: string;
  label: string;
  path: string;
}

export interface ProfileRecord {
  employeeId: number;
  adminId: number | null;

  // ---- the HRMS's own record --------------------------------------------
  employeeCode: string;
  fullName: string;
  workEmail: string;
  designation: string | null;
  department: string | null;
  workMode: WorkMode;
  workState: string;
  shiftStart: string;
  shiftEnd: string;
  weeklyOff: string[];
  dateOfJoining: string;
  dateOfLeaving: string | null;

  /** Resolved by a self join, so the header can say "reports to …" in one query. */
  managerId: number | null;
  managerName: string | null;

  // ---- personal details, owned by `admins` -------------------------------
  mobile: string | null;
  personalEmail: string | null;
  dateOfBirth: string | null;
  emergencyMobile: string | null;
  city: string | null;
  linkedinProfile: string | null;

  /** Only the documents actually on file. An empty list is a real answer. */
  documents: ProfileDocument[];
}

/**
 * The pay figures My page shows, for a viewer entitled to see them.
 *
 * A separate object rather than loose fields on the view, so "may this person
 * see pay at all" is one null check in the UI instead of six — and so a new pay
 * field cannot be added without passing through the gate that builds this.
 */
export interface CompensationView {
  effectiveFrom: string;
  ctc: number;
  variablePay: number;
  bonus: number;
  esopUnits: number;
  esopVestedPct: number;
  /** Units actually held today, derived from the grant and the vested share. */
  esopVestedUnits: number;
  revisionNote: string | null;
}

// ---------------------------------------------------------------- the view

/**
 * What My page receives. Assembled from `ProfileRecord` plus the leave balance,
 * and trimmed to what this particular viewer is allowed to see.
 */
export interface ProfileView {
  /** Why this viewer is being shown the page. Drives the UI's read-only hints. */
  access: 'self' | 'manager' | 'admin';
  isSelf: boolean;

  employeeId: number;
  employeeCode: string;
  fullName: string;
  workEmail: string;
  designation: string | null;
  department: string | null;
  workMode: WorkMode;
  workState: string;
  shiftStart: string;
  shiftEnd: string;
  weeklyOff: string[];
  dateOfJoining: string;
  dateOfLeaving: string | null;
  managerName: string | null;

  mobile: string | null;
  personalEmail: string | null;
  dateOfBirth: string | null;
  emergencyMobile: string | null;
  city: string | null;
  linkedinProfile: string | null;

  documents: ProfileDocument[];

  /** Days available today, from the leave engine — never recomputed here. */
  leaveBalance: number;

  /**
   * Pay, or null.
   *
   * Null carries two different meanings, and `canSeeCompensation` tells them
   * apart for the UI: the viewer is not entitled to see it, or nobody has loaded
   * it yet. A manager viewing a report gets null here NOT because the card is
   * hidden in the browser, but because the figures never left the server.
   */
  compensation: CompensationView | null;
  canSeeCompensation: boolean;

  /**
   * Goals for the current financial year, with progress and status resolved.
   *
   * Not gated the way pay is: a goal is work, and a manager seeing what their
   * report is aiming at is the point of having them. Empty is a real answer —
   * most people have none set.
   */
  goals: GoalView[];

  /** Work this person is known for. Open to anyone who can open the page. */
  projects: ProjectRecord[];

  /**
   * Notes about this person that THIS viewer may read.
   *
   * Already filtered: a `managers_only` note is absent from the response for
   * the subject, not merely hidden by the card.
   */
  feedback: FeedbackRecord[];

}
