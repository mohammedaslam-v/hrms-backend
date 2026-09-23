import { SlabBreakupRow, SurchargeInfo, TaxComputationView, TdsScheduleView } from "./tax.model";

export const TAX_CONFIG = {
  companyName: "Bambinos Learning Private Limited",
  companyAddress: "Koramangala, Bengaluru, Karnataka 560034",
  pan: "AAECB1234K",
  tan: "BLRB09876G",
  fy: "2026-27",
  ay: "2027-28",
  fyStart: "2026-04-01",
  fyEnd: "2027-03-31",
  stdDeduction: 75000,
  rebateCap: 1200000,
  rebateMax: 60000,
  cess: 0.04,
  slabs: [
    [400000, 0],
    [800000, 0.05],
    [1200000, 0.10],
    [1600000, 0.15],
    [2000000, 0.20],
    [2400000, 0.25],
    [Infinity, 0.30],
  ] as [number, number][],
  surcharge: [
    [5000000, 0],
    [10000000, 0.10],
    [20000000, 0.15],
    [Infinity, 0.25],
  ] as [number, number][],
};

export function fyMonths(uptoMonthKey?: string): string[] {
  const out: string[] = [];
  let y = 2026;
  let m = 4;
  for (let i = 0; i < 12; i++) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    out.push(k);
    if (uptoMonthKey && k === uptoMonthKey) break;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export function slabBreakup(taxableIncome: number): { rows: SlabBreakupRow[]; tax: number } {
  const rows: SlabBreakupRow[] = [];
  let prev = 0;
  let tax = 0;

  for (const [cap, rate] of TAX_CONFIG.slabs) {
    if (taxableIncome <= prev) break;
    const amt = Math.min(taxableIncome, cap) - prev;
    const t = amt * rate;
    rows.push({
      from: prev,
      to: cap === Infinity ? null : cap,
      rate,
      amount: amt,
      tax: t,
    });
    tax += t;
    prev = cap;
    if (taxableIncome <= cap) break;
  }

  return { rows, tax };
}

export function surchargeOn(taxableIncome: number, tax: number): SurchargeInfo {
  let rate = 0;
  for (const [cap, r] of TAX_CONFIG.surcharge) {
    if (taxableIncome <= cap) {
      rate = r;
      break;
    }
  }

  if (!rate) return { rate: 0, amount: 0, relief: 0 };
  const amount = tax * rate;

  let threshold = 0;
  let prevRate = 0;
  for (const [cap, r] of TAX_CONFIG.surcharge) {
    if (taxableIncome > cap) {
      threshold = cap;
      prevRate = r;
    }
  }

  if (threshold) {
    const taxAtThreshold = slabBreakup(threshold).tax * (1 + prevRate);
    const excess = taxableIncome - threshold;
    const total = tax + amount;
    if (total - taxAtThreshold > excess) {
      const relief = total - taxAtThreshold - excess;
      return { rate, amount: Math.max(0, amount - relief), relief };
    }
  }

  return { rate, amount, relief: 0 };
}

export function computeTaxComputation(
  basicAnnual: number,
  hraAnnual: number,
  specialAnnual: number,
  variablePay: number = 0,
  bonus: number = 0,
): { computation: TaxComputationView; slabRows: SlabBreakupRow[] } {
  const grossSalary = basicAnnual + hraAnnual + specialAnnual + variablePay + bonus;
  const stdDeduction = TAX_CONFIG.stdDeduction;
  const npsDeduction = 0; // Section 80CCD(2) employer NPS if opted

  const taxableIncome = Math.max(0, grossSalary - stdDeduction - npsDeduction);
  const bk = slabBreakup(taxableIncome);
  const slabTax = bk.tax;

  let rebate87A = 0;
  let marginalRelief87A = 0;

  if (taxableIncome <= TAX_CONFIG.rebateCap) {
    rebate87A = Math.min(slabTax, TAX_CONFIG.rebateMax);
  } else {
    const excess = taxableIncome - TAX_CONFIG.rebateCap;
    if (slabTax > excess) {
      marginalRelief87A = slabTax - excess;
    }
  }

  const afterRebate = Math.max(0, slabTax - rebate87A - marginalRelief87A);
  const sur = surchargeOn(taxableIncome, afterRebate);
  const cessAmount = (afterRebate + sur.amount) * TAX_CONFIG.cess;
  const totalTax = Math.round(afterRebate + sur.amount + cessAmount);
  const monthlyTds = Math.round(totalTax / 12);
  const effectiveTaxRate = grossSalary > 0 ? (totalTax / grossSalary) * 100 : 0;

  const computation: TaxComputationView = {
    basicAnnual,
    hraAnnual,
    specialAnnual,
    variablePay,
    bonus,
    grossSalary,
    stdDeduction,
    npsDeduction,
    taxableIncome,
    slabTax,
    rebate87A,
    marginalRelief87A,
    surchargeRate: sur.rate,
    surchargeAmount: sur.amount,
    surchargeRelief: sur.relief,
    cessRate: TAX_CONFIG.cess,
    cessAmount,
    totalTax,
    monthlyTds,
    effectiveTaxRate,
  };

  return { computation, slabRows: bk.rows };
}

export function computeTdsSchedule(
  totalTax: number,
  monthlyTds: number,
  currentMonthKey: string,
  actualDeducted?: number,
): TdsScheduleView {
  
  const elapsedMonths = fyMonths(currentMonthKey);
  const monthsElapsedCount = Math.min(12, Math.max(1, elapsedMonths.length));

  // If actual deducted TDS is recorded from payroll runs/frozen payslips, use it,
  // otherwise estimate using standard schedule (monthly * elapsed up to last month).
  const deductedTillDate =
    typeof actualDeducted === "number" && actualDeducted > 0
      ? actualDeducted
      : monthlyTds * Math.max(0, monthsElapsedCount - 1);

  const remainingThisFy = Math.max(0, totalTax - deductedTillDate);
  const percentageDeducted =
    totalTax > 0 ? Math.min(100, Math.round((deductedTillDate / totalTax) * 100)) : 0;

  const explanationNote =
    totalTax === 0
      ? "Your taxable income stays within ₹12,00,000, so the section 87A rebate wipes out the tax and nothing is deducted."
      : "TDS is spread evenly across the twelve months and revised if your pay or declarations change.";

  return {
    monthsElapsed: monthsElapsedCount,
    totalMonths: 12,
    deductedTillDate,
    remainingThisFy,
    percentageDeducted,
    explanationNote,
  };
}
