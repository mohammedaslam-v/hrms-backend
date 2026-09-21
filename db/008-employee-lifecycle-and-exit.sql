-- ---------------------------------------------------------------------------
-- Migration: 008-employee-lifecycle-and-exit.sql
-- Add employee exit, lifecycle controls, and soft-delete columns to hrms_employees.
-- ---------------------------------------------------------------------------

USE bambinos_updated;

ALTER TABLE hrms_employees
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL DEFAULT NULL AFTER updated_at,
  ADD COLUMN IF NOT EXISTS is_login_disabled TINYINT(1) NOT NULL DEFAULT 0 AFTER deleted_at,
  ADD COLUMN IF NOT EXISTS login_disabled_at TIMESTAMP NULL DEFAULT NULL AFTER is_login_disabled,
  ADD COLUMN IF NOT EXISTS is_salary_stopped TINYINT(1) NOT NULL DEFAULT 0 AFTER login_disabled_at,
  ADD COLUMN IF NOT EXISTS salary_stopped_at TIMESTAMP NULL DEFAULT NULL AFTER is_salary_stopped,
  ADD COLUMN IF NOT EXISTS salary_stop_reason VARCHAR(255) NULL DEFAULT NULL AFTER salary_stopped_at,
  ADD COLUMN IF NOT EXISTS resignation_date DATE NULL DEFAULT NULL AFTER salary_stop_reason,
  ADD COLUMN IF NOT EXISTS resignation_reason TEXT NULL DEFAULT NULL AFTER resignation_date,
  ADD COLUMN IF NOT EXISTS is_notice_serving TINYINT(1) NOT NULL DEFAULT 1 AFTER resignation_reason,
  ADD COLUMN IF NOT EXISTS last_working_day DATE NULL DEFAULT NULL AFTER is_notice_serving,
  ADD COLUMN IF NOT EXISTS is_rehire_eligible TINYINT(1) NOT NULL DEFAULT 1 AFTER last_working_day,
  ADD COLUMN IF NOT EXISTS exit_notes TEXT NULL DEFAULT NULL AFTER is_rehire_eligible;
