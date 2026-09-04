import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/api-error';
import { verifyAccessToken } from '../utils/jwt';

export interface AuthenticatedRequest extends Request {
  employeeId: number;
  adminId: number | null;
}

/**
 * Establishes *who* is asking. It deliberately does not establish what they may do —
 * tiers are resolved per request from the database, never read out of the token.
 */
export const requireAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(new ApiError(401, 'Sign in to continue.'));
    return;
  }

  try {
    const payload = verifyAccessToken(header.slice('Bearer '.length));
    const employeeId = Number(payload.sub);
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      throw new ApiError(401, 'Sign in to continue.');
    }

    const authed = req as AuthenticatedRequest;
    authed.employeeId = employeeId;
    authed.adminId = payload.adminId ?? null;
    next();
  } catch (err) {
    next(err);
  }
};
