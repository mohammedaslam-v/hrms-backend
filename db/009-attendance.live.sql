-- ---------------------------------------------------------------------------
-- hrms_attendance — LIVE
--
-- One row per person per day. The stored punch record: the OTHER attendance
-- source is hrms_activity_day's observed slots, and the two are combined on
-- read, never merged in storage.
--
-- THE UNIQUE KEY IS NOT OPTIONAL
--   attendance.repository.ts checkIn() is written as: try to claim an existing
--   row with an UPDATE ... WHERE login_at IS NULL, and if no row matched, INSERT
--   one. Two tabs racing both reach the INSERT. What stops them both succeeding
--   is uq_attendance_day: the loser gets ER_DUP_ENTRY, which the repository
--   catches and reads as "somebody already checked in".
--
--   Without this key there is no error, both rows insert, and findByDate() —
--   which returns rows[0] — starts picking one of the two arbitrarily. The bug
--   appears only under concurrency, which means it appears on live and not in
--   testing.
--
--   It also serves every query the module runs: WHERE employee_id = ? with
--   att_date = ? or BETWEEN, and ORDER BY att_date. A composite key on
--   (employee_id, att_date) is the index for all of them.
--
-- No FOREIGN KEY on employee_id or edited_by, matching the rest of the schema:
-- HRMS and the two admin portals write to this database independently, and a
-- constraint between them turns one side's problem into the other side's
-- outage. The join is on an indexed column and that is enough.
--
-- Safe to run during business hours: creates an empty table, touches nothing
-- that exists. Re-running it does nothing.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hrms_attendance (
  id               BIGINT NOT NULL AUTO_INCREMENT,
  employee_id      BIGINT NOT NULL,
  att_date         DATE NOT NULL,

  -- Written at check-in as a record of what was decided that morning. The
  -- displayed status is derived on read; this is the audit of the decision.
  status           ENUM('On time','Late','Absent','Half day','Leave','Holiday') NOT NULL,

  login_at         TIME NULL,
  logout_at        TIME NULL,

  -- DECIMAL, not FLOAT: hours are summed into payroll and a binary fraction
  -- that cannot represent 7.35 exactly has no business near a salary.
  active_hours     DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  late_by_minutes  SMALLINT NOT NULL DEFAULT 0,

  leave_type       ENUM('Casual','Sick','Earned','Unpaid') NULL,
  holiday_name     VARCHAR(150) NULL,

  source           ENUM('app','manual','import') NOT NULL DEFAULT 'app',
  edited_by        BIGINT NULL,
  edit_note        VARCHAR(255) NULL,

  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                   ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),

  -- The concurrency guard. See the note above before removing it.
  UNIQUE KEY uq_attendance_day (employee_id, att_date),

  -- For the roster read: WHERE att_date = ? AND employee_id IN (...).
  KEY idx_attendance_date (att_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
