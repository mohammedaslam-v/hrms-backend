import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { ApiError } from '../utils/api-error';

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
};

/**
 * Turns the handful of mysql2 errors that are really bad input into a 400 the
 * person can act on.
 *
 * These were reaching the catch-all below and surfacing as "Internal server
 * error", which tells the user nothing and the developer almost nothing: a goal
 * note longer than 500 characters took an afternoon to find, because the only
 * signal was a red box with no column, no limit and no way to tell it apart
 * from a genuine crash.
 *
 * Only genuine input faults are mapped. A missing table or a dropped connection
 * still raises a 500, because those are our fault and not something the person
 * filling the form can fix.
 */
const COLUMN = /column '([^']+)'/i;

const describeDbError = (err: unknown): string | null => {
  const e = err as { code?: string; sqlMessage?: string };
  const column = e.sqlMessage?.match(COLUMN)?.[1];
  const field = column ? `"${column}"` : 'One of the fields';

  switch (e.code) {
    case 'ER_DATA_TOO_LONG':
      return `${field} is longer than this field allows. Please shorten it.`;
    case 'ER_WARN_DATA_OUT_OF_RANGE':
      return `${field} is outside the range this field allows.`;
    case 'ER_TRUNCATED_WRONG_VALUE':
    case 'WARN_DATA_TRUNCATED':
      return `${field} is not in a format this field accepts.`;
    case 'ER_BAD_NULL_ERROR':
      return `${field} is required.`;
    case 'ER_DUP_ENTRY':
      return 'That record already exists.';
    case 'ER_NO_REFERENCED_ROW':
    case 'ER_NO_REFERENCED_ROW_2':
      return 'That refers to a record which no longer exists.';
    default:
      return null;
  }
};

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({ success: false, message: err.message });
    return;
  }

  const dbMessage = describeDbError(err);
  if (dbMessage) {
    // Still logged: a user-fixable fault is worth seeing, because a field people
    // keep overflowing is a field that needs a limit on the form.
    console.warn('[db] rejected input:', (err as { sqlMessage?: string }).sqlMessage ?? err.message);
    res.status(400).json({ success: false, message: dbMessage });
    return;
  }

  console.error(err);
  res.status(500).json({
    success: false,
    message: env.nodeEnv === 'production' ? 'Internal server error' : err.message,
  });
};
