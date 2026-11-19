-- ---------------------------------------------------------------------------
-- REFERENCE ONLY — do not run. The table already exists.
--
-- hrms_employee_compensation was created directly in the database, so its
-- definition was never in the repo. This is the output of
-- `SHOW CREATE TABLE hrms_employee_compensation` taken on 19 Nov 2026, kept so
-- a new developer can see the real columns without database access.
--
-- Later changes are in the numbered migrations (004 added the ESOP columns).
-- One row per pay revision, keyed on (employee_id, effective_from).
-- ---------------------------------------------------------------------------

CREATE TABLE `hrms_employee_compensation` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `employee_id` bigint NOT NULL,
  `effective_from` date NOT NULL,
  `ctc` bigint NOT NULL,
  `variable_pay` bigint NOT NULL DEFAULT '0',
  `bonus` bigint NOT NULL DEFAULT '0',
  `esop_units` int unsigned NOT NULL DEFAULT '0',
  `esop_vested_pct` decimal(5,2) NOT NULL DEFAULT '0.00',
  `revision_note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` bigint DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `basic_monthly` decimal(12,2) DEFAULT NULL,
  `hra_monthly` decimal(12,2) DEFAULT NULL,
  `special_monthly` decimal(12,2) DEFAULT NULL,
  `employer_pf_monthly` decimal(12,2) DEFAULT NULL,
  `gratuity_monthly` decimal(12,2) DEFAULT NULL,
  `employee_pf_monthly` decimal(12,2) DEFAULT NULL,
  `professional_tax_monthly` decimal(12,2) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_comp_effective` (`employee_id`,`effective_from`),
  KEY `idx_comp_lookup` (`employee_id`,`effective_from`),
  KEY `fk_comp_creator` (`created_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
