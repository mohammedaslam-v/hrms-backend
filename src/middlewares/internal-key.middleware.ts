import { timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { ApiError } from '../utils/api-error';

/**
 * Server-to-server only. The caller proves it holds INTERNAL_API_KEY in the
 * `x-internal-key` header. With no key configured every request is refused, so
 * forgetting the setting can never leave these routes open.
 */
export const requireInternalKey = (req: Request, _res: Response, next: NextFunction): void => {
  const expected = env.internalApiKey;
  if (!expected) {
    next(new ApiError(503, 'Internal API is not configured.'));
    return;
  }

  const provided = req.header('x-internal-key') ?? '';
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    next(new ApiError(401, 'Invalid internal key.'));
    return;
  }

  next();
};
