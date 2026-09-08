import bcrypt from 'bcryptjs';
import { env } from '../../config/env';
import { IAuthRepository } from './auth.repository.interface';
import { IAuthService } from './auth.service.interface';
import { IOtpService } from './otp.service.interface';
import {
  AuthenticatedEmployee,
  ChangePasswordDto,
  EmployeeCredentials,
  ForgotPasswordDto,
  highestTier,
  LoginDto,
  LoginResult,
  OtpChallenge,
  resolveTiers,
  ResetPasswordDto,
  SessionContext,
  VerifyOtpDto,
} from './auth.model';
import { ApiError } from '../../utils/api-error';
import { generateRefreshToken, hashToken, signAccessToken } from '../../utils/jwt';

/**
 * A real bcrypt hash of a value nobody knows, compared against when the account
 * does not exist. Keeps the failure path the same cost as the success path, so
 * response timing does not reveal which emails are registered.
 */
const TIMING_DECOY_HASH = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

/** One message for every failure mode — never leak which part was wrong. */
const INVALID_CREDENTIALS = 'That email or password is not correct.';

const BCRYPT_ROUNDS = 10; // matches admin-backend, so hashes stay interchangeable
const MIN_PASSWORD_LENGTH = 8;

/** Three active accounts hold an unusable secret (2 empty, 1 plaintext). */
const isBcryptHash = (hash: string | null): hash is string =>
  typeof hash === 'string' && /^\$2[aby]\$/.test(hash);

export class AuthService implements IAuthService {
  constructor(
    private readonly authRepository: IAuthRepository,
    private readonly otpService: IOtpService,
  ) {}

  /**
   * Step one of two. A correct password does NOT sign anyone in — it only earns
   * an OTP challenge. The session is minted in verifyOtp().
   */
  async login(dto: LoginDto, context: SessionContext): Promise<OtpChallenge> {
    const workEmail = dto.workEmail.trim().toLowerCase();
    const credentials = await this.authRepository.findCredentialsByWorkEmail(workEmail);

    // Deliberately NOT replicating admin-backend's `$2y$` branch, where submitting
    // the stored hash as the password succeeds. A leaked hash is not a credential.
    const hash = isBcryptHash(credentials?.passwordHash ?? null)
      ? (credentials!.passwordHash as string)
      : TIMING_DECOY_HASH;
    const passwordMatches = await bcrypt.compare(dto.password, hash);

    if (!credentials || !isBcryptHash(credentials.passwordHash) || !passwordMatches) {
      throw new ApiError(401, INVALID_CREDENTIALS);
    }

    this.assertUsableAccount(credentials);

    await this.authRepository.recordAudit(
      credentials.employeeId,
      'auth.password_verified',
      'hrms_employees',
      credentials.employeeId,
      context,
    );

    return this.otpService.issue(credentials.employeeId, workEmail, 'login', context.ipAddress);
  }

  /** Step two. Only this call creates a session. */
  async verifyOtp(dto: VerifyOtpDto, context: SessionContext): Promise<LoginResult> {
    const employeeId = await this.otpService.verify(dto.challengeId, dto.code, 'login');

    // Re-check the account between the two steps — it could have been closed.
    const credentials = await this.authRepository.findCredentialsByEmployeeId(employeeId);
    if (!credentials) throw new ApiError(401, INVALID_CREDENTIALS);
    this.assertUsableAccount(credentials);

    const employee = await this.getCurrentEmployee(employeeId);
    const tokens = await this.issueSession(employeeId, credentials.adminId as number, context);

    await this.authRepository.recordAudit(
      employeeId,
      'auth.login',
      'hrms_employees',
      employeeId,
      context,
    );

    return { ...tokens, employee };
  }

  async resendOtp(challengeId: string, context: SessionContext): Promise<OtpChallenge> {
    return this.otpService.resend(challengeId, context.ipAddress);
  }

  /**
   * Always reports success. Whether the address exists is not something an
   * unauthenticated caller gets to discover.
   */
  async forgotPassword(dto: ForgotPasswordDto, context: SessionContext): Promise<OtpChallenge> {
    const workEmail = dto.workEmail.trim().toLowerCase();
    const credentials = await this.authRepository.findCredentialsByWorkEmail(workEmail);

    const usable =
      credentials && credentials.adminId !== null && !this.hasLeft(credentials.dateOfLeaving);

    if (!usable) {
      // A challenge that was never stored: verification will fail exactly as a
      // wrong code would, so the response is indistinguishable from the real path.
      return this.decoyChallenge(workEmail);
    }

    await this.authRepository.recordAudit(
      credentials.employeeId,
      'auth.forgot_password_requested',
      'hrms_employees',
      credentials.employeeId,
      context,
    );

    return this.otpService.issue(
      credentials.employeeId,
      workEmail,
      'forgot_password',
      context.ipAddress,
    );
  }

  /**
   * Checks a reset code without spending it, so the UI can gate the new-password
   * screen. This is not a grant of anything — resetPassword() re-verifies.
   */
  async verifyResetOtp(dto: VerifyOtpDto): Promise<void> {
    await this.otpService.verify(dto.challengeId, dto.code, 'forgot_password', {
      consume: false,
    });
  }

  /**
   * There is no path to a new password that skips this OTP check — the challenge
   * is the only thing that identifies the account being reset.
   */
  async resetPassword(dto: ResetPasswordDto, context: SessionContext): Promise<void> {
    this.assertPasswordPolicy(dto.newPassword);

    const employeeId = await this.otpService.verify(
      dto.challengeId,
      dto.code,
      'forgot_password',
    );

    const credentials = await this.authRepository.findCredentialsByEmployeeId(employeeId);
    if (!credentials || credentials.adminId === null) {
      throw new ApiError(404, 'No HRMS profile found for this account.');
    }
    this.assertUsableAccount(credentials);

    const hash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.authRepository.updateAdminPassword(credentials.adminId, hash);

    // A reset invalidates every existing session — if the account was taken over,
    // resetting the password must actually evict the attacker.
    await this.authRepository.revokeAllSessionsForEmployee(employeeId, 'password_reset');

    await this.authRepository.recordAudit(
      employeeId,
      'auth.password_reset',
      'admins',
      credentials.adminId,
      context,
    );
  }

  async changePassword(
    employeeId: number,
    dto: ChangePasswordDto,
    context: SessionContext,
  ): Promise<void> {
    this.assertPasswordPolicy(dto.newPassword);

    const credentials = await this.authRepository.findCredentialsByEmployeeId(employeeId);
    if (!credentials || credentials.adminId === null || !isBcryptHash(credentials.passwordHash)) {
      throw new ApiError(403, 'This account cannot change its password here. Contact HR.');
    }

    const matches = await bcrypt.compare(dto.currentPassword, credentials.passwordHash);
    if (!matches) {
      throw new ApiError(401, 'Your current password is not correct.');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw ApiError.badRequest('The new password must be different from the current one.');
    }

    const hash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.authRepository.updateAdminPassword(credentials.adminId, hash);

    // Sign out everywhere, including this session — changing a password should
    // end any session opened with the old one.
    await this.authRepository.revokeAllSessionsForEmployee(employeeId, 'password_changed');

    await this.authRepository.recordAudit(
      employeeId,
      'auth.password_changed',
      'admins',
      credentials.adminId,
      context,
    );
  }

  async refresh(refreshToken: string, context: SessionContext): Promise<LoginResult> {
    const session = await this.authRepository.findActiveSessionByHash(hashToken(refreshToken));
    if (!session) {
      throw new ApiError(401, 'Your session has expired. Please sign in again.');
    }

    // Re-check the account on every refresh. Without this, a 7-day refresh token
    // issued before someone left would keep working for the rest of its life.
    const credentials = await this.authRepository.findCredentialsByEmployeeId(session.employeeId);
    if (!credentials || credentials.adminId === null || this.hasLeft(credentials.dateOfLeaving)) {
      await this.authRepository.revokeAllSessionsForEmployee(session.employeeId, 'account_inactive');
      throw new ApiError(401, 'This account is no longer active. Please sign in again.');
    }

    // Rotate: the presented token is retired before a new one is issued.
    await this.authRepository.revokeSession(session.id, 'rotated');

    const employee = await this.getCurrentEmployee(session.employeeId);
    const tokens = await this.issueSession(session.employeeId, credentials.adminId, context);

    return { ...tokens, employee };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    const session = await this.authRepository.findActiveSessionByHash(hashToken(refreshToken));
    if (session) {
      await this.authRepository.revokeSession(session.id, 'logout');
    }
  }

  async getCurrentEmployee(employeeId: number): Promise<AuthenticatedEmployee> {
    const [profile, tierInputs] = await Promise.all([
      this.authRepository.findEmployeeProfile(employeeId),
      this.authRepository.findTierInputs(employeeId),
    ]);

    if (!profile || !tierInputs) {
      throw new ApiError(404, 'No HRMS profile found for this account.');
    }

    const tiers = resolveTiers(tierInputs);
    return { ...profile, tiers, defaultTier: highestTier(tiers) };
  }

  // ---------------------------------------------------------------- helpers

  private assertUsableAccount(credentials: EmployeeCredentials): void {
    if (credentials.adminId === null) {
      throw new ApiError(403, 'This profile has no linked login account. Contact HR.');
    }
    if (this.hasLeft(credentials.dateOfLeaving)) {
      throw new ApiError(403, 'This account is no longer active. Contact HR.');
    }
  }

  private assertPasswordPolicy(password: string): void {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      throw ApiError.badRequest(
        `Your new password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
    }
  }

  private decoyChallenge(workEmail: string): OtpChallenge {
    const [local, domain] = workEmail.split('@');
    const masked = domain
      ? `${local.slice(0, 2)}${'•'.repeat(Math.max(3, local.length - 2))}@${domain}`
      : '•••';
    return {
      challengeId: generateRefreshToken(),
      sentTo: masked,
      expiresAt: new Date(Date.now() + env.otp.ttlMinutes * 60 * 1000).toISOString(),
      resendAvailableAt: new Date(
        Date.now() + env.otp.resendCooldownSeconds * 1000,
      ).toISOString(),
    };
  }

  private async issueSession(employeeId: number, adminId: number, context: SessionContext) {
    const refreshToken = generateRefreshToken();
    const refreshTokenExpiresAt = new Date(
      Date.now() + env.auth.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    );

    await this.authRepository.createSession(
      employeeId,
      hashToken(refreshToken),
      refreshTokenExpiresAt,
      context,
    );

    return {
      accessToken: signAccessToken(employeeId, adminId),
      accessTokenExpiresAt: new Date(
        Date.now() + env.auth.accessTokenTtlMinutes * 60 * 1000,
      ).toISOString(),
      refreshToken,
      refreshTokenExpiresAt,
    };
  }

  private hasLeft(dateOfLeaving: string | null): boolean {
    if (!dateOfLeaving) return false;
    return dateOfLeaving < new Date().toISOString().slice(0, 10);
  }
}
