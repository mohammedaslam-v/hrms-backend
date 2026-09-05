/**
 * My page — the employee's own profile, and the profile a manager opens for
 * someone in their reporting line.
 *
 * The record here is the raw read. Nothing on it is gated: deciding what a
 * particular viewer may see (pay, restricted feedback) is the service's job, so
 * that a single rule governs it rather than each caller remembering.
 */

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
   * Blocks the page renders but cannot fill yet, with the reason. The design has
   * nine cards; six of them are waiting on data that does not exist in the
   * system, and saying so beats a card that looks broken.
   */
  pending: { block: string; reason: string }[];
}
