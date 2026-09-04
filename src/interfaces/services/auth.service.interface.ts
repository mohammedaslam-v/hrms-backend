import {
  AuthenticatedEmployee,
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  LoginResult,
  OtpChallenge,
  ResetPasswordDto,
  SessionContext,
  VerifyOtpDto,
} from '../../models/auth.model';

export interface IAuthService {
  /**
   * Verifies the password and issues an OTP challenge. Deliberately returns no
   * session — a correct password alone never signs anyone in.
   */
  login(dto: LoginDto, context: SessionContext): Promise<OtpChallenge>;

  /** The only call that mints a session. */
  verifyOtp(dto: VerifyOtpDto, context: SessionContext): Promise<LoginResult>;

  resendOtp(challengeId: string, context: SessionContext): Promise<OtpChallenge>;

  /** Always succeeds, whether or not the address exists. */
  forgotPassword(dto: ForgotPasswordDto, context: SessionContext): Promise<OtpChallenge>;

  /** Checks a reset code without spending it, so the UI can gate the next screen. */
  verifyResetOtp(dto: VerifyOtpDto): Promise<void>;

  /** Requires a valid `forgot_password` OTP; there is no other route to a reset. */
  resetPassword(dto: ResetPasswordDto, context: SessionContext): Promise<void>;

  changePassword(
    employeeId: number,
    dto: ChangePasswordDto,
    context: SessionContext,
  ): Promise<void>;

  /** Rotates the refresh token and re-verifies that the account is still valid. */
  refresh(refreshToken: string, context: SessionContext): Promise<LoginResult>;

  logout(refreshToken: string | undefined): Promise<void>;

  /** Resolves tiers fresh, so grants and revocations take effect immediately. */
  getCurrentEmployee(employeeId: number): Promise<AuthenticatedEmployee>;
}
