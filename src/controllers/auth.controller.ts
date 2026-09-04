import { CookieOptions, Request, RequestHandler, Response } from 'express';
import { isProduction } from '../config/env';
import { IAuthService } from '../interfaces/services/auth.service.interface';
import {
  ChangePasswordDto,
  LoginDto,
  LoginResult,
  ResetPasswordDto,
  SessionContext,
  VerifyOtpDto,
} from '../models/auth.model';
import { ApiError } from '../utils/api-error';
import { asyncHandler } from '../utils/async-handler';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';

export const REFRESH_COOKIE = 'hrms_refresh';

export class AuthController {
  constructor(private readonly authService: IAuthService) {}

  /** Password step. Returns a challenge, never a session. */
  login: RequestHandler = asyncHandler(async (req, res) => {
    const dto = this.toLoginDto(req.body);
    const challenge = await this.authService.login(dto, this.contextOf(req));
    res.json({ success: true, data: { otpRequired: true, ...challenge } });
  });

  verifyOtp: RequestHandler = asyncHandler(async (req, res) => {
    const dto = this.toVerifyOtpDto(req.body);
    const result = await this.authService.verifyOtp(dto, this.contextOf(req));
    this.respondWithSession(res, result);
  });

  resendOtp: RequestHandler = asyncHandler(async (req, res) => {
    const challengeId = this.readString(req.body, 'challengeId');
    const challenge = await this.authService.resendOtp(challengeId, this.contextOf(req));
    res.json({ success: true, data: challenge });
  });

  forgotPassword: RequestHandler = asyncHandler(async (req, res) => {
    const workEmail = this.readString(req.body, 'workEmail');
    const challenge = await this.authService.forgotPassword({ workEmail }, this.contextOf(req));
    res.json({ success: true, data: challenge });
  });

  verifyResetOtp: RequestHandler = asyncHandler(async (req, res) => {
    const dto = this.toVerifyOtpDto(req.body);
    await this.authService.verifyResetOtp(dto);
    res.json({ success: true, data: { verified: true } });
  });

  resetPassword: RequestHandler = asyncHandler(async (req, res) => {
    const dto = this.toResetPasswordDto(req.body);
    await this.authService.resetPassword(dto, this.contextOf(req));
    // Every session was revoked, so the cookie in the browser is now dead.
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    res.json({ success: true, data: null });
  });

  changePassword: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const dto = this.toChangePasswordDto(req.body);
    await this.authService.changePassword(employeeId, dto, this.contextOf(req));
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    res.json({ success: true, data: null });
  });

  refresh: RequestHandler = asyncHandler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!token) {
      throw new ApiError(401, 'Your session has expired. Please sign in again.');
    }
    const result = await this.authService.refresh(token, this.contextOf(req));
    this.respondWithSession(res, result);
  });

  logout: RequestHandler = asyncHandler(async (req, res) => {
    await this.authService.logout(req.cookies?.[REFRESH_COOKIE] as string | undefined);
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    res.json({ success: true, data: null });
  });

  me: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const employee = await this.authService.getCurrentEmployee(employeeId);
    res.json({ success: true, data: { employee } });
  });

  // ---------------------------------------------------------------- helpers

  private respondWithSession(res: Response, result: LoginResult): void {
    this.setRefreshCookie(res, result.refreshToken, result.refreshTokenExpiresAt);
    res.json({
      success: true,
      data: {
        employee: result.employee,
        accessToken: result.accessToken,
        accessTokenExpiresAt: result.accessTokenExpiresAt,
      },
    });
  }

  private readString(body: unknown, field: string): string {
    const b = (body ?? {}) as Record<string, unknown>;
    const value = typeof b[field] === 'string' ? (b[field] as string).trim() : '';
    if (!value) {
      throw ApiError.badRequest(`${field} is required.`);
    }
    return value;
  }

  private toLoginDto(body: unknown): LoginDto {
    const b = (body ?? {}) as Record<string, unknown>;
    const workEmail = typeof b.workEmail === 'string' ? b.workEmail.trim() : '';
    const password = typeof b.password === 'string' ? b.password : '';
    if (!workEmail || !password) {
      throw ApiError.badRequest('Enter both your work email and your password.');
    }
    return { workEmail, password };
  }

  private toVerifyOtpDto(body: unknown): VerifyOtpDto {
    const b = (body ?? {}) as Record<string, unknown>;
    const challengeId = this.readString(body, 'challengeId');
    const code = typeof b.code === 'string' ? b.code.trim() : '';
    if (!/^\d{6}$/.test(code)) {
      throw ApiError.badRequest('Enter the 6-digit code.');
    }
    return { challengeId, code };
  }

  private toResetPasswordDto(body: unknown): ResetPasswordDto {
    const b = (body ?? {}) as Record<string, unknown>;
    const challengeId = this.readString(body, 'challengeId');
    const code = typeof b.code === 'string' ? b.code.trim() : '';
    const newPassword = typeof b.newPassword === 'string' ? b.newPassword : '';
    if (!/^\d{6}$/.test(code)) {
      throw ApiError.badRequest('Enter the 6-digit code.');
    }
    if (!newPassword) {
      throw ApiError.badRequest('Enter a new password.');
    }
    return { challengeId, code, newPassword };
  }

  private toChangePasswordDto(body: unknown): ChangePasswordDto {
    const b = (body ?? {}) as Record<string, unknown>;
    const currentPassword = typeof b.currentPassword === 'string' ? b.currentPassword : '';
    const newPassword = typeof b.newPassword === 'string' ? b.newPassword : '';
    if (!currentPassword || !newPassword) {
      throw ApiError.badRequest('Enter your current password and a new one.');
    }
    return { currentPassword, newPassword };
  }

  private contextOf(req: Request): SessionContext {
    return {
      userAgent: req.get('user-agent')?.slice(0, 255) ?? null,
      ipAddress: req.ip ?? null,
    };
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true, // XSS cannot read it; the access token stays in memory only
      sameSite: 'lax',
      secure: isProduction,
      path: '/api/v1/auth',
    };
  }

  private setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
    res.cookie(REFRESH_COOKIE, token, { ...this.cookieOptions(), expires: expiresAt });
  }
}
