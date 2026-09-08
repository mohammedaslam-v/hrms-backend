import {
  AuthenticatedEmployee,
  EmployeeCredentials,
  OtpPurpose,
  SessionContext,
  StoredOtp,
  TierInputs,
} from './auth.model';

export interface CreateOtpInput {
  challengeToken: string;
  employeeId: number;
  purpose: OtpPurpose;
  codeHash: string;
  maxAttempts: number;
  sentTo: string;
  expiresAt: Date;
  ipAddress: string | null;
}

export interface IAuthRepository {
  /**
   * Resolves a login identifier to one employee. `work_email` is unique on
   * `hrms_employees`, so duplicate rows in `admins` can never make this ambiguous.
   */
  findCredentialsByWorkEmail(workEmail: string): Promise<EmployeeCredentials | null>;

  findCredentialsByEmployeeId(employeeId: number): Promise<EmployeeCredentials | null>;

  /** Tier inputs, read fresh — never cached in a token. */
  findTierInputs(employeeId: number): Promise<TierInputs | null>;

  findEmployeeProfile(
    employeeId: number,
  ): Promise<Omit<AuthenticatedEmployee, 'tiers' | 'defaultTier'> | null>;

  /**
   * Where an OTP should be sent. Email comes from HRMS; the mobile is read from
   * `admins`, which is the only place a phone number is held.
   */
  findDeliveryTargets(
    employeeId: number,
  ): Promise<{ email: string | null; mobile: string | null } | null>;

  // --- passwords (the only column HRMS ever writes in `admins`) ---
  updateAdminPassword(adminId: number, passwordHash: string): Promise<void>;

  // --- one-time codes ---
  createOtp(input: CreateOtpInput): Promise<void>;
  findOtpByChallenge(challengeToken: string): Promise<StoredOtp | null>;
  incrementOtpAttempts(otpId: number): Promise<number>;
  consumeOtp(otpId: number): Promise<void>;
  consumeOpenOtps(employeeId: number, purpose: OtpPurpose): Promise<void>;
  secondsSinceLastOtp(employeeId: number, purpose: OtpPurpose): Promise<number>;

  // --- sessions ---
  createSession(
    employeeId: number,
    refreshTokenHash: string,
    expiresAt: Date,
    context: SessionContext,
  ): Promise<number>;

  findActiveSessionByHash(
    refreshTokenHash: string,
  ): Promise<{ id: number; employeeId: number } | null>;

  revokeSession(sessionId: number, reason: string): Promise<void>;

  revokeAllSessionsForEmployee(employeeId: number, reason: string): Promise<void>;

  recordAudit(
    actorEmployeeId: number | null,
    action: string,
    entityType: string,
    entityId: number | null,
    context: SessionContext,
  ): Promise<void>;
}
