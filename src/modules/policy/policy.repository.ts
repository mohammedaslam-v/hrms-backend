import { Pool, RowDataPacket } from 'mysql2/promise';
import { IPolicyRepository } from './policy.repository.interface';
import { FinancialYearConfig } from './policy.model';

interface FyRow extends RowDataPacket {
  fy: string;
  ay: string;
  fy_start: string;
  fy_end: string;
  late_grace_minutes: number;
  goal_risk_tolerance_pct: number;
  basic_pct: string;
  hra_pct_of_basic: string;
  gratuity_pct: string;
  pf_ceiling: number;
  pf_rate: string;
  eps_rate: string;
  eps_cap: number;
  std_deduction: number;
  rebate_cap: number;
  rebate_max: number;
  cess_rate: string;
}

export class PolicyRepository implements IPolicyRepository {
  constructor(private readonly pool: Pool) {}

  async findFinancialYearForDate(date: string): Promise<FinancialYearConfig | null> {
    const [rows] = await this.pool.execute<FyRow[]>(
      `SELECT fy, ay, fy_start, fy_end,
              late_grace_minutes, goal_risk_tolerance_pct,
              basic_pct, hra_pct_of_basic, gratuity_pct,
              pf_ceiling, pf_rate, eps_rate, eps_cap,
              std_deduction, rebate_cap, rebate_max, cess_rate
         FROM hrms_fy_config
        WHERE ? BETWEEN fy_start AND fy_end`,
      [date],
    );

    const row = rows[0];
    if (!row) return null;

    return {
      fy: row.fy,
      ay: row.ay,
      fyStart: row.fy_start,
      fyEnd: row.fy_end,
      lateGraceMinutes: row.late_grace_minutes,
      goalRiskTolerancePct: row.goal_risk_tolerance_pct,
      // DECIMAL columns arrive as strings from the driver — Number() here, so no
      // caller ever does arithmetic on a string and silently concatenates.
      basicPct: Number(row.basic_pct),
      hraPctOfBasic: Number(row.hra_pct_of_basic),
      gratuityPct: Number(row.gratuity_pct),
      pfCeiling: row.pf_ceiling,
      pfRate: Number(row.pf_rate),
      epsRate: Number(row.eps_rate),
      epsCap: row.eps_cap,
      stdDeduction: row.std_deduction,
      rebateCap: row.rebate_cap,
      rebateMax: row.rebate_max,
      cessRate: Number(row.cess_rate),
    };
  }
}
