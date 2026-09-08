-- ---------------------------------------------------------------------------
-- 004 — ESOP columns on hrms_employee_compensation
--
-- The Compensation card on My page shows ESOP units and a vesting percentage,
-- and there is nowhere to put either today.
--
-- They belong on the compensation row rather than on hrms_employees: a grant
-- changes on the same occasions a CTC revision does, and this table is already
-- a history (uq_comp_effective on employee_id + effective_from), so keeping
-- them here preserves the history for free.
--
-- Additive and reversible. The table is owned by HRMS alone — no other
-- application reads or writes it — and the rollback is at the bottom.
-- ---------------------------------------------------------------------------

ALTER TABLE hrms_employee_compensation
  ADD COLUMN esop_units      INT UNSIGNED NOT NULL DEFAULT 0
    COMMENT 'granted units at this revision; 0 means no grant'
    AFTER bonus,
  ADD COLUMN esop_vested_pct DECIMAL(5,2) NOT NULL DEFAULT 0.00
    COMMENT 'share of the grant vested, 0.00 to 100.00'
    AFTER esop_units;

-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- ALTER TABLE hrms_employee_compensation
--   DROP COLUMN esop_vested_pct,
--   DROP COLUMN esop_units;
