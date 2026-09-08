import { Pool, RowDataPacket } from 'mysql2/promise';

/**
 * What day it is, according to the database.
 *
 * Not a convenience. The Node process and MariaDB can sit in different
 * timezones — in this project's own environment they are currently a full day
 * apart — so a service that calls `new Date()` will disagree with the rows it is
 * comparing against. That decides whether a goal reads Missed, whether a pay
 * revision has taken effect, and which month a leave ledger stops at.
 *
 * Injected as an interface so a test can place itself on any date without a
 * database, and so every module answers "what day is it" the same way.
 */
export interface IClock {
  /** Today as YYYY-MM-DD, from the database server. */
  today(): Promise<string>;
}

interface TodayRow extends RowDataPacket {
  d: string;
}

export class DatabaseClock implements IClock {
  constructor(private readonly pool: Pool) {}

  async today(): Promise<string> {
    const [rows] = await this.pool.query<TodayRow[]>('SELECT CURDATE() AS d');
    return rows[0].d;
  }
}

/** A fixed clock, for tests and for replaying a day. */
export class FixedClock implements IClock {
  constructor(private readonly date: string) {}
  today(): Promise<string> {
    return Promise.resolve(this.date);
  }
}
