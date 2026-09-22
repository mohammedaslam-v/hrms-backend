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

export interface SaveDocumentDto {
  key: DocumentKey;
  label?: string;
  fileName?: string;
  fileBase64?: string;
  docNumber?: string;
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
  managerName: string | null;

  mobile: string | null;
  personalEmail: string | null;
  dateOfBirth: string | null;
  emergencyMobile: string | null;
  city: string | null;
  linkedinProfile: string | null;

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
