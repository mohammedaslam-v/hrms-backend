/**
 * My page — the employee's own profile, and the profile a manager opens for
 * someone in their reporting line.
 */

import { FeedbackRecord } from '../feedback/feedback.model';
import { GoalView } from '../goals/goals.model';
import { ProjectRecord } from '../projects/projects.model';

export type WorkMode = 'WFH' | 'WFO' | 'Hybrid';

export type DocumentKey =
  | 'pan'
  | 'aadhaar'
  | 'photo'
  | 'resume'
  | 'permanentAddress'
  | 'temporaryAddress'
  | (string & {});

/**
 * A file uploaded during onboarding or by the employee on My Page.
 */
export interface ProfileDocument {
  key: DocumentKey;
  label: string;
  path: string;
  docNumber?: string | null;
}

/**
 * What a document download resolves to.
 *
 * Bytes rather than a path: the file now lives in Cloud Storage and there is no
 * path to send. Returning a bucket URL instead would hand out something that
 * bypasses the access check, so the route streams these bytes itself.
 *
 * `redirect` covers only the links the old Laravel portal stored, which already
 * point at its own public assets.
 */
export type DocumentFileResult =
  | { kind: 'redirect'; url: string }
  | { kind: 'buffer'; buffer: Buffer; contentType: string; filename: string };

export interface SaveDocumentDto {
  key: DocumentKey;
  label?: string;
  fileName?: string;
  fileBase64?: string;
  docNumber?: string;
}

export interface UpdatePersonalDetailsDto {
  employeeCode?: string | null;
  fullName?: string | null;
  designation?: string | null;
  department?: string | null;
  email?: string | null;
  mobile?: string | null;
  dateOfBirth?: string | null;
  pan?: string | null;
  aadhar?: string | null;
  workLocation?: string | null;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  weeklyOff?: string[] | string | null;
  dateOfJoining?: string | null;
  leaveBalance?: number | null;
  managerId?: number | null;
  role?: "employee" | "manager" | "admin" | null;
  confirmationDate?: string | null;
  dateOfLeaving?: string | null;
  uan?: string | null;
  pfNumber?: string | null;
  bankName?: string | null;
  ifscCode?: string | null;
  accountNo?: string | null;
  emergencyContactName?: string | null;
  emergencyContactNumber?: string | null;
  emergencyContactRelation?: string | null;
}

export interface DismissEmployeeDto {
  resignationDate: string | null;
  resignationReason: string;
  isNoticeServing: boolean;
  lastWorkingDay: string;
  isRehireEligible: boolean;
  exitNotes?: string | null;
}

export interface ToggleLoginDto {
  disabled: boolean;
}

export interface UpdateEmploymentTypeDto {
  employmentType: string;
}

export interface UpdateCompensationDto {
  effectiveFrom?: string;
  ctc: number;
  variablePay?: number;
  bonus?: number;
  esopUnits?: number;
  esopVestedPct?: number;
  revisionNote?: string | null;
}

export interface ToggleSalaryDto {
  stopped: boolean;
  reason?: string | null;
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
  employmentType: string;
  isContractor: boolean;
  workMode: WorkMode;
  workState: string;
  shiftStart: string;
  shiftEnd: string;
  weeklyOff: string[];
  dateOfJoining: string;
  dateOfLeaving: string | null;
  confirmationDate: string | null;
  uan: string | null;
  pfNumber: string | null;
  bankName: string | null;
  ifscCode: string | null;
  accountNo: string | null;

  /** Resolved by a self join, so the header can say "reports to …" in one query. */
  managerId: number | null;
  managerName: string | null;

  // ---- personal details, owned by `admins` -------------------------------
  mobile: string | null;
  personalEmail: string | null;
  dateOfBirth: string | null;
  /**
   * HRMS's own value when it has one, otherwise `admins.emergency_mobile`.
   * The name and relationship live only on `hrms_employees` — the shared table
   * has no column for either, and this portal does not add columns to it.
   */
  emergencyMobile: string | null;
  emergencyContactName: string | null;
  emergencyContactRelation: string | null;
  /** Set per employee by HR when the profile gate cannot apply — e.g. staff
   *  outside India with no PAN or Aadhaar to upload. */
  profileGateExempt: boolean;
  city: string | null;
  linkedinProfile: string | null;
  panNumber: string | null;
  aadharNumber: string | null;
  hrmsRole?: "employee" | "admin";
  isManagerOverride?: boolean;
  role?: "employee" | "manager" | "admin";

  /** Only the documents actually on file. An empty list is a real answer. */
  documents: ProfileDocument[];

  // ---- lifecycle & exit fields -------------------------------------------
  isLoginDisabled: boolean;
  loginDisabledAt: string | null;
  isSalaryStopped: boolean;
  salaryStoppedAt: string | null;
  salaryStopReason: string | null;
  resignationDate: string | null;
  resignationReason: string | null;
  isNoticeServing: boolean;
  lastWorkingDay: string | null;
  isRehireEligible: boolean;
  exitNotes: string | null;
  deletedAt: string | null;
}

export interface CompensationView {
  effectiveFrom: string;
  ctc: number;
  variablePay: number;
  bonus: number;
  esopUnits: number;
  esopVestedPct: number;
  esopVestedUnits: number;
  revisionNote: string | null;
}

export interface ProfileView {
  access: 'self' | 'manager' | 'admin';
  isSelf: boolean;

  employeeId: number;
  employeeCode: string;
  fullName: string;
  workEmail: string;
  designation: string | null;
  department: string | null;
  employmentType: string;
  isContractor: boolean;
  workMode: WorkMode;
  workState: string;
  shiftStart: string;
  shiftEnd: string;
  weeklyOff: string[];
  dateOfJoining: string;
  dateOfLeaving: string | null;
  confirmationDate: string | null;
  uan: string | null;
  pfNumber: string | null;
  bankName: string | null;
  ifscCode: string | null;
  accountNo: string | null;
  managerName: string | null;

  mobile: string | null;
  personalEmail: string | null;
  dateOfBirth: string | null;
  emergencyMobile: string | null;
  emergencyContactName: string | null;
  emergencyContactRelation: string | null;
  /** Set per employee by HR when the profile gate cannot apply — e.g. staff
   *  outside India with no PAN or Aadhaar to upload. */
  profileGateExempt: boolean;
  city: string | null;
  linkedinProfile: string | null;
  panNumber: string | null;
  aadharNumber: string | null;
  managerId?: number | null;
  role?: "employee" | "manager" | "admin";
  hrmsRole?: "employee" | "admin";

  documents: ProfileDocument[];
  leaveBalance: number;

  compensation: CompensationView | null;
  canSeeCompensation: boolean;

  goals: GoalView[];
  projects: ProjectRecord[];
  feedback: FeedbackRecord[];

  // ---- lifecycle & exit flags -------------------------------------------
  isLoginDisabled: boolean;
  loginDisabledAt: string | null;
  isSalaryStopped: boolean;
  salaryStoppedAt: string | null;
  salaryStopReason: string | null;
  resignationDate: string | null;
  resignationReason: string | null;
  isNoticeServing: boolean;
  lastWorkingDay: string | null;
  isRehireEligible: boolean;
  exitNotes: string | null;
  deletedAt: string | null;
}
