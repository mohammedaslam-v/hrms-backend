import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { ApiError } from './api-error';

/**
 * The access token carries identity only — never tiers.
 * Authorization is resolved per request so a revoked grant takes effect immediately
 * rather than when the token happens to expire.
 */
export interface AccessTokenPayload {
  sub: string;
  adminId: number | null;
}

export const signAccessToken = (employeeId: number, adminId: number | null): string =>
  jwt.sign({ sub: String(employeeId), adminId }, env.auth.jwtSecret, {
    expiresIn: `${env.auth.accessTokenTtlMinutes}m`,
    issuer: 'hrms',
  });

export const verifyAccessToken = (token: string): AccessTokenPayload => {
  try {
    return jwt.verify(token, env.auth.jwtSecret, { issuer: 'hrms' }) as AccessTokenPayload;
  } catch {
    throw new ApiError(401, 'Your session has expired. Please sign in again.');
  }
};

/**
 * Refresh tokens are opaque random strings, not JWTs — so they can be revoked
 * server-side. Only the SHA-256 digest is stored; the raw value lives in the cookie.
 */
export const generateRefreshToken = (): string => crypto.randomBytes(32).toString('hex');

export const hashToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');
