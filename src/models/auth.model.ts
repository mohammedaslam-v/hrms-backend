/**
 * Access tiers stack rather than exclude: everyone on payroll is an employee,
 * anyone with reports is additionally a manager, and admin is an explicit grant.
 */
export type AccessTier = 'employee' | 'manager' | 'admin';

/** The signed-in person as HRMS sees them. Never carries compensation. */
export interface AuthenticatedEmployee {
  id: number;
  employeeCode: string;
  fullName: string;
  workEmail: string;
  department: string | null;
  designation: string | null;
  dateOfJoining: string;
  tiers: AccessTier[];
  /** Highest tier held — decides the landing page. */
  defaultTier: AccessTier;
}

/** What the login lookup needs from the `admins` join to verify a password. */
export interface EmployeeCredentials {
  employeeId: number;
  adminId: number | null;
  passwordHash: string | null;
  dateOfLeaving: string | null;
}

/** Raw tier inputs, resolved fresh on every request rather than cached in a token. */
export interface TierInputs {
  hrmsRole: 'employee' | 'admin';
  isManagerOverride: boolean;
  hasActiveReports: boolean;
}

export interface LoginDto {
  workEmail: string;
  password: string;
}

/** OTP purposes. `step_up` is reserved for re-auth before payroll actions. */
export type OtpPurpose = 'login' | 'step_up' | 'forgot_password';

/**
 * Handed back after the password step succeeds. The opaque challenge is the only
 * thing the browser holds — it never learns an employee id, and the challenge is
 * what proves the password step was passed.
 */
export interface OtpChallenge {
  challengeId: string;
  sentTo: string;
  expiresAt: string;
  resendAvailableAt: string;
}

export interface VerifyOtpDto {
  challengeId: string;
  code: string;
}

export interface ForgotPasswordDto {
  workEmail: string;
}

export interface ResetPasswordDto {
  challengeId: string;
  code: string;
  newPassword: string;
}

export interface ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
}

/** A stored challenge as the repository returns it. */
export interface StoredOtp {
  id: number;
  employeeId: number;
  purpose: OtpPurpose;
  codeHash: string;
  attempts: number;
  maxAttempts: number;
  expired: boolean;
  consumed: boolean;
}

/** ashish@bambinos.in -> as•••@bambinos.in — enough to recognise, not enough to harvest. */
export const maskEmail = (email: string): string => {
  const [local, domain] = email.split('@');
  if (!domain) return '•••';
  const head = local.slice(0, 2);
  return `${head}${'•'.repeat(Math.max(3, local.length - 2))}@${domain}`;
};

export interface SessionTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export interface LoginResult extends SessionTokens {
  employee: AuthenticatedEmployee;
}

export interface SessionContext {
  userAgent: string | null;
  ipAddress: string | null;
}

/** Everything above employee tier is derived here, in one place. */
export const resolveTiers = (inputs: TierInputs): AccessTier[] => {
  const tiers: AccessTier[] = ['employee'];
  if (inputs.hasActiveReports || inputs.isManagerOverride) {
    tiers.push('manager');
  }
  if (inputs.hrmsRole === 'admin') {
    tiers.push('admin');
  }
  return tiers;
};

/** Highest tier held, used for the landing page and the default "view as". */
export const highestTier = (tiers: AccessTier[]): AccessTier => {
  if (tiers.includes('admin')) return 'admin';
  if (tiers.includes('manager')) return 'manager';
  return 'employee';
};
