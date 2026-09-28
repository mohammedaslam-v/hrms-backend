-- ---------------------------------------------------------------------------
-- 006 — activity slots — LIVE
--
-- The live counterpart of 006-activity-slots.sql. Same table, two differences,
-- both because this one runs against a database with real data in it:
--
--   1. No DROP TABLE. The dev script drops first so it can be re-run while the
--      shape is still changing. On live that is a data-loss command, so it is
--      gone and CREATE TABLE IF NOT EXISTS takes its place — running this twice
--      does nothing the second time.
--   2. No FOREIGN KEY to admins, matching dev. The writer is the Laravel portal
--      and the reader is HRMS; a constraint between them would make an HRMS
--      migration able to block an admin-portal insert. The join is on
--      hrms_employees.admin_id, which is already UNIQUE.
--
-- The table holds no string columns at all — every column is numeric, date,
-- time or timestamp — so the server's default charset and collation cannot
-- affect it. CHARSET is stated only to keep the two files comparable.
--
-- Safe to run during business hours: it creates an empty table and touches
-- nothing that exists.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hrms_activity_day (
  admin_id      BIGINT UNSIGNED  NOT NULL,
  act_date      DATE             NOT NULL,

  -- Bit N = the half hour starting at N*30 minutes past midnight.
  -- Slot 0 is 00:00–00:30, slot 47 is 23:30–24:00. 48 bits, so it fits.
  slot_mask     BIGINT UNSIGNED  NOT NULL DEFAULT 0,

  -- Set once by the first write of the day and never updated: it stands in for
  -- a check-in time on screen. last_seen_at moves with every write.
  first_seen_at TIME             NULL,
  last_seen_at  TIME             NULL,

  -- Bit 0 = the new React portal, bit 1 = the old Laravel one. Without this a
  -- quiet day is indistinguishable from one portal having stopped reporting.
  source_mask   TINYINT UNSIGNED NOT NULL DEFAULT 0,

  created_at    TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                 ON UPDATE CURRENT_TIMESTAMP,

  -- The upsert depends on this being the PRIMARY KEY. Without it ON DUPLICATE
  -- KEY never fires and every ping inserts a fresh row instead of OR-ing into
  -- the existing one.
  PRIMARY KEY (admin_id, act_date),
  KEY idx_activity_date (act_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
