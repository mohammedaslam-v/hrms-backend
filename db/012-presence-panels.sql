-- ==============================================================================
-- 012 — Presence across every Bambinos panel
-- ==============================================================================
--
-- `admin_panel_presence` (one row per admin: where they were last seen) gains
-- two columns, so the active list can say WHICH panel and page someone is on:
--
--   last_panel  — 'renewals', 'crm', 'faculty', … ; NULL = the admin panel's
--                 own heartbeat (so every existing row keeps meaning what it
--                 meant, and nothing has to be backfilled).
--   last_title  — the page title another panel's tab reported, for display.
--
-- `admin_panel_presence_day` (each admin's total per India day) needs NO
-- change: pings from every panel add into the same daily total, and two tabs
-- open at once are not double counted (only the gap since the last ping, from
-- any panel, is added).
--
-- ORDER: run this BEFORE deploying hrms-backend and admin-backend. Both start
-- writing these columns as soon as they are deployed.
--
-- Safe to run on the live table: adding NULL columns to a table of ~500 rows is
-- instant, and no existing value changes.
-- ==============================================================================

-- 1. Preview: the table as it is now (expect no last_panel / last_title yet).
SHOW COLUMNS FROM admin_panel_presence;
SELECT COUNT(*) AS rows_now FROM admin_panel_presence;

-- 2. The change.
ALTER TABLE admin_panel_presence
  ADD COLUMN last_panel VARCHAR(32)  NULL DEFAULT NULL AFTER last_path,
  ADD COLUMN last_title VARCHAR(191) NULL DEFAULT NULL AFTER last_panel;

-- 3. Check: both columns present, every existing row NULL (= admin panel).
SHOW COLUMNS FROM admin_panel_presence;
SELECT COUNT(*) AS rows_after, SUM(last_panel IS NULL) AS still_admin_panel FROM admin_panel_presence;
