import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/api-error';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * A small fixed-window limiter, kept in process memory.
 *
 * Enough to stop credential stuffing and OTP guessing from a single client on a
 * single instance. It does NOT survive a restart and is NOT shared across
 * instances — move it to Redis before running more than one API process.
 */
const buckets = new Map<string, Bucket>();

const sweep = (now: number): void => {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
};

export const rateLimit = (options: { windowSeconds: number; max: number; key: string }) => {
  const windowMs = options.windowSeconds * 1000;

  return (req: Request, _res: Response, next: NextFunction): void => {
    const now = Date.now();
    sweep(now);

    // Bucket per route + caller + submitted identifier, so one person hammering
    // an account cannot lock out everyone else on the same NAT.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const identifier =
      typeof body.workEmail === 'string' ? body.workEmail.trim().toLowerCase() : '';
    const bucketKey = `${options.key}:${req.ip ?? 'unknown'}:${identifier}`;

    const existing = buckets.get(bucketKey);
    if (!existing || existing.resetAt <= now) {
      buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    existing.count += 1;
    if (existing.count > options.max) {
      const seconds = Math.ceil((existing.resetAt - now) / 1000);
      next(new ApiError(429, `Too many attempts. Try again in ${seconds} seconds.`));
      return;
    }
    next();
  };
};
