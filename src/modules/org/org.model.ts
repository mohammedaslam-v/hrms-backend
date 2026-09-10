import { WorkMode } from '../profile/profile.model';

/** A person as the organisation structure sees them. */
export interface TeamMember {
  id: number;
  employeeCode: string;
  fullName: string;
  designation: string | null;
}

/**
 * A person as the Team directory lists them.
 *
 * Deliberately work-facing only: no personal contact details, no identity
 * documents, no pay. A directory is a list of colleagues, and the cheapest way
 * to be sure something cannot leak into a list of 450 people is not to fetch it.
 * Pay is joined in separately, and only for a viewer entitled to see it.
 */
export interface RosterMember extends TeamMember {
  department: string | null;
  /** Resolved by a self join. Null for the people at the top. */
  managerName: string | null;
  workMode: WorkMode;
  shiftStart: string;
  shiftEnd: string;
  weeklyOff: string[];
  dateOfJoining: string;
  /** Null while they are still with the company. */
  dateOfLeaving: string | null;
}

/** Whose roster to build, and whether people who have left are included. */
export interface RosterScope {
  /**
   * The manager whose tree to walk, or null for the whole company.
   *
   * Null is an admin's view. It is a separate case rather than a special root
   * id, so "everyone" can never be produced by accident from a bad id.
   */
  rootId: number | null;
  /** The directory's Active / Exited filter needs both. Defaults to false. */
  includeLeavers?: boolean;
}
