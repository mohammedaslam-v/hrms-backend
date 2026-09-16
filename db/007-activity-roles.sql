-- ---------------------------------------------------------------------------
-- 007 — who is measured by activity is decided in CODE, not in the database
--
-- An earlier draft of this work added `hrms_employees.attendance_mode` and used
-- it to decide both where a person's hours came from AND whether they could
-- press check in. Both of those turned out to be wrong:
--
--   · Everyone keeps check-in and check-out. It is not a privilege to be taken
--     away by a role, and an SSM who wants to declare their day should be able
--     to.
--   · The role list belongs somewhere it can be changed in one line without a
--     migration and without backfilling 318 rows.
--
-- So the column goes, and the list lives in
--
--     src/modules/attendance/attendance.config.ts   →  ACTIVITY_MEASURED_ROLES
--
-- read against `admins.role` on every request. Adding a role takes effect on
-- the next page load.
--
-- Safe to run whether or not the earlier version was ever applied.
-- ---------------------------------------------------------------------------

SET @drop := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME   = 'hrms_employees'
         AND COLUMN_NAME  = 'attendance_mode'
    ),
    'ALTER TABLE hrms_employees DROP COLUMN attendance_mode',
    'SELECT 1'
  )
);
PREPARE stmt FROM @drop;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
