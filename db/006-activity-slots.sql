-- ---------------------------------------------------------------------------
-- 006 — activity slots
--
-- The day is cut into 48 half-hour slots. Bit N of `slot_mask` is set when the
-- portal saw the person do something in slot N. Active hours are BIT_COUNT of
-- the mask, halved — derived on every read, never stored, the same rule the
-- leave balance and the goal progress already follow.
--
-- Written by the two admin portals, read by HRMS. Both already point at this
-- schema, so nothing is deployed between them.
--
-- WHY A MASK RATHER THAN A ROW PER PING
--   ~460 admins pinging through a nine-hour day is roughly 50,000 rows a day
--   appended, needing a pruning job. This is one row per person per day, about
--   460 a day, and it still draws the timeline: the mask says WHICH half hours,
--   not merely how many. You cannot inflate somebody's total without changing
--   which slots they were seen in.
--
-- WHY THE SLOT SIZE IS NOT CONFIGURABLE
--   A stored mask only means anything against the slot size it was written
--   with. Putting 30 in `hrms_fy_config` next to `late_grace_minutes` would let
--   somebody silently reinterpret every historical row by changing a setting.
--   It is a constant in the domain layer; changing it is a migration.
--
-- Keyed on admin_id because the WRITER is the admin portal, which knows nothing
-- about HRMS and should not have to. HRMS joins through hrms_employees.admin_id,
-- which is already UNIQUE. The dependency stays one-way.
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS hrms_activity_day;

CREATE TABLE hrms_activity_day (
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
  -- KEY never fires and every ping inserts a fresh row — which is exactly the
  -- bug admin_daily_activity_summary is exposed to today.
  PRIMARY KEY (admin_id, act_date),
  KEY idx_activity_date (act_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
