export const COMPANY_CONFIG = {
  name: "Bambinos Learning Private Limited",
  address: "Koramangala, Bengaluru, Karnataka 560034",
  pan: "AAECB1234K",
  tan: "BLRB09876G",
  fy: "2026-27",
  ay: "2027-28",
  fyStart: "2026-04-01",
  fyEnd: "2027-03-31",
  pfCeiling: 15000,
  pfRate: 0.12,
  epsCeiling: 15000,
  epsRate: 0.0833,
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
};

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

export function monthLabel(mKey: string): string {
  const parts = mKey.split("-");
  if (parts.length < 2) return mKey;
  const m = Number(parts[1]);
  return `${MONTH_NAMES[m - 1] || ""} ${parts[0]}`;
}

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

/**
 * The salary rules, as HR specified them:
 *
 *   Basic              40% of Gross
 *   HRA                50% of Basic
 *   Special allowance  the balance of Gross
 *   Employer PF        12% of Basic, on a PF wage capped at ₹15,000/month
 *   Gratuity           4.81% of Basic
 *   Employee PF        12% of Basic, same cap
 *   Net                Gross − Employee PF − Professional Tax
 *   CTC                Gross + Employer PF + Gratuity
 *
 * Only CTC is entered, so Gross is solved for. Basic is a fixed share of
 * Gross and both PF and gratuity are shares of Basic, so CTC is a straight
 * line in Gross — until Basic crosses the PF wage cap, after which PF stops
 * growing and the line changes slope. `grossFromCtc` picks the right piece.
 */
export const SALARY_RULES = {
  basicPctOfGross: 0.40,
  hraPctOfBasic: 0.50,
  pfRate: 0.12,
  gratuityPctOfBasic: 0.0481,
} as const;

/** Gross for a given CTC over the same period (a month, or a year). */
export function grossFromCtc(ctc: number, pfWageCeiling: number): number {
  const { basicPctOfGross: b, pfRate: pf, gratuityPctOfBasic: gr } = SALARY_RULES;
  const uncapped = ctc / (1 + b * pf + b * gr);
  if (b * uncapped <= pfWageCeiling) return uncapped;
  return (ctc - pf * pfWageCeiling) / (1 + b * gr);
}

/**
 * One period's split. Every component is rounded, and Gross is then taken as
 * whatever CTC is left after employer PF and gratuity — so the parts always
 * add back to the CTC to the rupee, with Special absorbing the rounding.
 */
function split(ctc: number, pfWageCeiling: number) {
  const r = SALARY_RULES;
  const basic = Math.round(grossFromCtc(ctc, pfWageCeiling) * r.basicPctOfGross);
  const hra = Math.round(basic * r.hraPctOfBasic);
  const pfWage = Math.min(basic, pfWageCeiling);
  const pf = Math.round(pfWage * r.pfRate);
  const gratuity = Math.round(basic * r.gratuityPctOfBasic);
  const gross = Math.round(ctc) - pf - gratuity;
  const special = Math.max(0, gross - basic - hra);
  return { basic, hra, special, gross, pf, pfWage, gratuity };
}

export function structure(ctc: number) {
  const annualCtc = Math.max(0, Math.round(ctc || 0));
  const ceilingM = COMPANY_CONFIG.pfCeiling;

  // The month and the year are each split from their own CTC rather than one
  // being the other times twelve, so a CTC that does not divide by 12 still
  // balances exactly in both views.
  const m = split(annualCtc / 12, ceilingM);
  const a = split(annualCtc, ceilingM * 12);

  // EPS is the pension slice carved out of the employer's PF; the rest is EPF.
  const epsM = Math.min(
    Math.round(Math.min(m.pfWage, COMPANY_CONFIG.epsCeiling) * COMPANY_CONFIG.epsRate),
    1250,
  );

  return {
    ctc: annualCtc,
    basicA: a.basic,
    basicM: m.basic,
    hraA: a.hra,
    hraM: m.hra,
    pfWage: m.pfWage,
    eePfA: a.pf,
    eePfM: m.pf,
    erPfA: a.pf,
    erPfM: m.pf,
    epsM,
    erEpfM: m.pf - epsM,
    gratA: a.gratuity,
    gratM: m.gratuity,
    specialA: a.special,
    specialM: m.special,
    grossA: a.gross,
    grossM: m.gross,
  };
}

export function ptFor(state: string, gross: number, mKey?: string): number {
  const isFeb = mKey && mKey.slice(5) === "02";
  switch ((state || "").toLowerCase()) {
    case "karnataka":
      return gross >= 25000 ? 200 : 0;
    case "maharashtra":
      return gross <= 7500 ? 0 : gross <= 10000 ? 175 : (isFeb ? 300 : 200);
    case "telangana":
      return gross < 15000 ? 0 : gross <= 20000 ? 150 : 200;
    case "tamil nadu":
      return gross <= 7500 ? 0 : gross <= 12500 ? 125 : 208;
    case "delhi":
      return 0;
    default:
      return gross >= 25000 ? 200 : 0;
  }
}

export function computeTax(grossSalaryAnnual: number) {
  const taxable = Math.max(0, grossSalaryAnnual - COMPANY_CONFIG.stdDeduction);
  let prev = 0;
  let tax = 0;

  for (const [cap, rate] of COMPANY_CONFIG.slabs) {
    if (taxable <= prev) break;
    const amt = Math.min(taxable, cap) - prev;
    tax += amt * rate;
    prev = cap;
    if (taxable <= cap) break;
  }

  let rebate = 0;
  let marginalRelief = 0;
  if (taxable <= COMPANY_CONFIG.rebateCap) {
    rebate = Math.min(tax, COMPANY_CONFIG.rebateMax);
  } else {
    const excess = taxable - COMPANY_CONFIG.rebateCap;
    if (tax > excess) marginalRelief = tax - excess;
  }

  const afterRebate = Math.max(0, tax - rebate - marginalRelief);
  const cess = afterRebate * COMPANY_CONFIG.cess;
  const total = Math.round(afterRebate + cess);
  const monthly = Math.round(total / 12);

  return { total, monthly, taxable };
}

export function words(n: number): string {
  n = Math.round(n || 0);
  if (n === 0) return "Zero rupees only";
  if (n < 0) return "Negative " + words(-n);

  const a = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen"
  ];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  const two = (x: number) => (x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? " " + a[x % 10] : ""));
  const three = (x: number) => (x > 99 ? a[Math.floor(x / 100)] + " Hundred" + (x % 100 ? " " + two(x % 100) : "") : two(x));

  let s = "";
  const cr = Math.floor(n / 10000000);
  n %= 10000000;
  const lk = Math.floor(n / 100000);
  n %= 100000;
  const th = Math.floor(n / 1000);
  n %= 1000;

  if (cr) s += three(cr) + " Crore ";
  if (lk) s += three(lk) + " Lakh ";
  if (th) s += three(th) + " Thousand ";
  if (n) s += three(n);

  return s.trim() + " rupees only";
}
