import { ApiError } from "../../utils/api-error";
import { IAccessService } from "../access/access.service.interface";
import { IAttendanceService } from "../attendance/attendance.service.interface";
import { ICompensationService } from "../compensation/compensation.service.interface";
import { ILeaveService } from "../leave/leave.service.interface";
import {
  COMPANY_CONFIG,
  NOT_MARKED_LOP_FROM,
  arrearsOwed,
  computeTax,
  fyMonths,
  monthLabel,
  payStructure,
  previousMonth,
  ptOf,
  words,
  type PaidMonth,
} from "./salary.domain";
import {
  AnnualStructureView,
  EmployeeLoanView,
  MySalaryView,
  PayslipHistoryItem,
  SalarySlip,
} from "./salary.model";
import { ISalaryRepository } from "./salary.repository.interface";
import { ISalaryService } from "./salary.service.interface";

export class SalaryService implements ISalaryService {
  constructor(
    private readonly salaryRepository: ISalaryRepository,
    private readonly compensationService: ICompensationService,
    private readonly accessService: IAccessService,
    private readonly leaveService: ILeaveService,
    private readonly attendanceService: IAttendanceService,
  ) {}

  /**
   * Loss-of-pay days for each month asked for: what the leave ledger settles,
   * plus every working day the calendar shows as Not Marked.
   *
   * Both halves are derived on read, so an admin correcting a day from the
   * calendar changes that month's pay the next time it is opened — no reversal
   * to remember. Not Marked only counts from NOT_MARKED_LOP_FROM, the day
   * employees started using the portal; before it, an empty day means nothing.
   *
   * Many months cost the same as one: one ledger per leave year, and one
   * attendance read per year-long span.
   */
  private async lopDaysByMonth(
    employeeId: number,
    months: string[],
    dateOfJoining: string | null,
    dateOfLeaving: string | null,
  ): Promise<Map<string, number>> {
    const sorted = [...new Set(months)].sort();
    if (sorted.length === 0) return new Map();

    const spans: { from: string; to: string }[] = [];
    for (const month of sorted) {
      const from = `${month}-01`;
      const [y, mo] = month.split("-").map(Number);
      const to = `${month}-${String(new Date(y, mo, 0).getDate()).padStart(2, "0")}`;
      const last = spans[spans.length - 1];
      // getDays reads at most 366 days, so a run of months is split by year.
      if (last && last.from.slice(0, 4) === from.slice(0, 4)) last.to = to;
      else spans.push({ from, to });
    }

    const [leaveLop, ...dayRuns] = await Promise.all([
      this.leaveService.lopDaysByMonth(employeeId, sorted),
      // The attendance read refuses anyone who has already left, so a leaver's
      // final months are settled on leave alone.
      ...spans.map((span) => this.attendanceService.getDays(employeeId, span.from, span.to).catch(() => [])),
    ]);

    const wanted = new Set(sorted);
    const notMarked = new Map<string, number>();
    for (const d of dayRuns.flat()) {
      // 'Absent' is only ever a past working day with no punch, no activity and
      // no leave — the domain gives today and later 'Not in yet'.
      if (
        d.status !== "Absent" ||
        d.date < NOT_MARKED_LOP_FROM ||
        (dateOfJoining && d.date < dateOfJoining) ||
        (dateOfLeaving && d.date > dateOfLeaving)
      ) {
        continue;
      }
      const month = d.date.slice(0, 7);
      if (wanted.has(month)) notMarked.set(month, (notMarked.get(month) ?? 0) + 1);
    }

    const out = new Map<string, number>();
    for (const month of sorted) {
      const total = (leaveLop.get(month) ?? 0) + (notMarked.get(month) ?? 0);
      out.set(month, Math.round(total * 10) / 10);
    }
    return out;
  }

  async getMySalary(
    viewerId: number,
    subjectId: number,
    monthKey?: string,
  ): Promise<MySalaryView> {
    const access = await this.accessService.require(viewerId, subjectId);
    if (access !== "self" && access !== "admin" && access !== "manager") {
      throw ApiError.forbidden("Compensation is between the employee, HR and the founder.");
    }

    const emp = await this.salaryRepository.findEmployeeMeta(subjectId);
    if (!emp) {
      throw ApiError.notFound("Employee record not found.");
    }

    const currentMonthKey = new Date().toISOString().slice(0, 7);
    const targetMonth = monthKey && /^\d{4}-\d{2}$/.test(monthKey) ? monthKey : currentMonthKey;

    const [y, m] = targetMonth.split("-").map(Number);
    const monthDays = new Date(y, m, 0).getDate();

    const comp = await this.compensationService.getCurrent(subjectId);
    const ctc = comp?.ctc || 0;
    const variablePay = comp?.variablePay || 0;
    const bonus = comp?.bonus || 0;

    const activeLoans = await this.salaryRepository.findActiveLoans(subjectId);
    let loanEmi = 0;
    let loanView: EmployeeLoanView | null = null;

    if (activeLoans.length > 0) {
      for (const al of activeLoans) {
        const [sy, sm] = al.start_month.split("-").map(Number);
        const monthsElapsed = (y - sy) * 12 + (m - sm);
        if (monthsElapsed >= 0 && monthsElapsed < al.tenure_months) {
          loanEmi += Number(al.emi);
        }
      }

      const primaryLoan = activeLoans[0];
      const [sy, sm] = primaryLoan.start_month.split("-").map(Number);
      const totalMonthsElapsed = Math.max(0, (y - sy) * 12 + (m - sm) + 1);
      const paidMonths = Math.min(primaryLoan.tenure_months, totalMonthsElapsed);
      const repaid = Math.min(Number(primaryLoan.principal), paidMonths * Number(primaryLoan.emi));
      const outstanding = Math.max(0, Number(primaryLoan.principal) - repaid);

      const endM = sm + primaryLoan.tenure_months - 1;
      const endYear = sy + Math.floor((endM - 1) / 12);
      const endMonthNum = ((endM - 1) % 12) + 1;
      const finalMonthKey = `${endYear}-${String(endMonthNum).padStart(2, "0")}`;

      loanView = {
        id: primaryLoan.id,
        purpose: primaryLoan.purpose,
        principal: Number(primaryLoan.principal),
        emi: Number(primaryLoan.emi),
        interestRate: Number(primaryLoan.interest_rate),
        startMonth: primaryLoan.start_month,
        tenureMonths: primaryLoan.tenure_months,
        paidMonths,
        repaidAmount: repaid,
        outstandingAmount: outstanding,
        finalMonth: monthLabel(finalMonthKey),
        status: primaryLoan.status,
      };
    }

    const dojMonth = emp.dateOfJoining ? emp.dateOfJoining.slice(0, 7) : "1970-01";
    const dolMonth = emp.dateOfLeaving ? emp.dateOfLeaving.slice(0, 7) : null;
    const isPaidInMonth = targetMonth >= dojMonth && (!dolMonth || targetMonth <= dolMonth);

    const frozenSlip = await this.salaryRepository.findFrozenPayslip(subjectId, targetMonth);
    const s = payStructure(ctc, comp?.components);
    const tax = computeTax(s.grossA + variablePay + bonus);

    let slip: SalarySlip | null = null;

    if (frozenSlip) {
      slip = {
        payMonth: frozenSlip.pay_month,
        monthLabel: monthLabel(frozenSlip.pay_month),
        monthDays: frozenSlip.month_days,
        payableDays: Number(frozenSlip.payable_days),
        lopDays: Number(frozenSlip.lop_days),
        lopAmount: Math.round(Number(frozenSlip.gross) / frozenSlip.month_days * Number(frozenSlip.lop_days)),
        lopRate: Math.round((Number(frozenSlip.gross) / frozenSlip.month_days) * 100) / 100,
        isContractor: emp.isContractor,
        employee: {
          id: emp.id,
          code: emp.code,
          name: emp.name,
          title: emp.title,
          department: emp.department,
          dateOfJoining: emp.dateOfJoining,
          pan: emp.pan,
          uan: emp.uan,
          bankAccount: emp.bankAccount,
          ifsc: emp.ifsc,
          workState: emp.workState,
        },
        earnings: {
          basic: Number(frozenSlip.basic),
          hra: Number(frozenSlip.hra),
          special: Number(frozenSlip.special_allowance),
          arrears: 0,
          gross: Number(frozenSlip.gross),
        },
        deductions: {
          employeePf: Number(frozenSlip.employee_pf),
          professionalTax: Number(frozenSlip.professional_tax),
          tds: Number(frozenSlip.tds),
          loanEmi: Number(frozenSlip.loan_emi),
          total: Number(frozenSlip.total_deductions),
        },
        netPay: Number(frozenSlip.net_pay),
        netPayWords: words(Number(frozenSlip.net_pay)),
        employer: {
          employerPf: Number(frozenSlip.employer_pf),
          eps: Number(frozenSlip.eps),
          employerEpf: Number(frozenSlip.employer_epf),
          pfWage: frozenSlip.pf_wage,
        },
        ytd: {
          annualCtc: ctc,
          annualTax: tax.total,
          tdsDeductedTillDate: tax.monthly * Math.max(1, m - 3),
        },
        isFrozen: true,
      };
    } else if (isPaidInMonth) {
      // A month already pushed keeps showing what was sent. Otherwise its LOP
      // is live, and — if the month before it was pushed — it also settles
      // whatever corrections have changed in paid months since.
      const pushes = await this.salaryRepository.findSalaryPushes(subjectId);
      const sent = pushes.get(targetMonth) ?? null;
      const paidBefore = pushes.has(previousMonth(targetMonth))
        ? [...pushes.values()].filter((p): p is PaidMonth => p != null && p.month < targetMonth)
        : [];
      const live = await this.lopDaysByMonth(
        subjectId,
        [...(sent ? [] : [targetMonth]), ...paidBefore.map((p) => p.month)],
        emp.dateOfJoining,
        emp.dateOfLeaving,
      );

      const lopDays = Math.min(monthDays, sent ? sent.lopDays : (live.get(targetMonth) ?? 0));
      const arrears = sent ? sent.arrearsAmount : arrearsOwed(paidBefore, live);
      const payableDays = Math.max(0, monthDays - lopDays);
      const factor = monthDays > 0 ? payableDays / monthDays : 1;
      const monthlyGross = emp.isContractor ? Math.round(ctc / 12) : s.grossM;
      const lopRate = sent ? sent.lopRate : monthDays > 0 ? Math.round((monthlyGross / monthDays) * 100) / 100 : 0;

      if (emp.isContractor) {
        const monthlyRetainer = monthlyGross;
        const gross = Math.round(monthlyRetainer * factor) + arrears;
        const tds = Math.round(gross * 0.10);
        const net = Math.max(0, gross - tds - loanEmi);
        const totalDeductions = tds + loanEmi;

        slip = {
          payMonth: targetMonth,
          monthLabel: monthLabel(targetMonth),
          monthDays,
          payableDays,
          lopDays,
          lopAmount: Math.round(lopRate * lopDays),
          lopRate,
          isContractor: true,
          employee: {
            id: emp.id,
            code: emp.code,
            name: emp.name,
            title: emp.title,
            department: emp.department,
            dateOfJoining: emp.dateOfJoining,
            pan: emp.pan,
            uan: emp.uan,
            bankAccount: emp.bankAccount,
            ifsc: emp.ifsc,
            workState: emp.workState,
          },
          earnings: {
            basic: gross - arrears,
            hra: 0,
            special: 0,
            arrears,
            gross,
          },
          deductions: {
            employeePf: 0,
            professionalTax: 0,
            tds,
            loanEmi,
            total: totalDeductions,
          },
          netPay: net,
          netPayWords: words(net),
          employer: {
            employerPf: 0,
            eps: 0,
            employerEpf: 0,
            pfWage: 0,
          },
          ytd: {
            annualCtc: ctc,
            annualTax: Math.round(ctc * 0.10),
            tdsDeductedTillDate: tds * Math.max(1, m - 3),
          },
          isFrozen: false,
        };
      } else {
        const basic = Math.round(s.basicM * factor);
        const hra = Math.round(s.hraM * factor);
        const special = Math.round(s.specialM * factor);
        // Arrears are paid on top of the month's earnings; PF and tax stay on
        // the month's own earnings.
        const gross = basic + hra + special + arrears;

        const pt = ptOf(comp?.components, emp.workState, s.grossM, targetMonth);
        // Employee PF on the Basic actually earned this month, under the same
        // cap the structure uses. HR's own figure, when they set one, is
        // pro-rated the same way the earnings are.
        const eePf = comp?.components
          ? Math.round(s.eePfM * factor)
          : Math.round(Math.min(basic, COMPANY_CONFIG.pfCeiling) * COMPANY_CONFIG.pfRate);
        const tds = tax.monthly;
        const totalDeductions = eePf + pt + tds + loanEmi;
        const net = Math.max(0, gross - totalDeductions);

        slip = {
          payMonth: targetMonth,
          monthLabel: monthLabel(targetMonth),
          monthDays,
          payableDays,
          lopDays,
          lopAmount: Math.round(lopRate * lopDays),
          lopRate,
          isContractor: false,
          employee: {
            id: emp.id,
            code: emp.code,
            name: emp.name,
            title: emp.title,
            department: emp.department,
            dateOfJoining: emp.dateOfJoining,
            pan: emp.pan,
            uan: emp.uan,
            bankAccount: emp.bankAccount,
            ifsc: emp.ifsc,
            workState: emp.workState,
          },
          earnings: {
            basic,
            hra,
            special,
            arrears,
            gross,
          },
          deductions: {
            employeePf: eePf,
            professionalTax: pt,
            tds,
            loanEmi,
            total: totalDeductions,
          },
          netPay: net,
          netPayWords: words(net),
          employer: {
            employerPf: s.erPfM,
            eps: s.epsM,
            employerEpf: s.erEpfM,
            pfWage: s.pfWage,
          },
          ytd: {
            annualCtc: ctc,
            annualTax: tax.total,
            tdsDeductedTillDate: tax.monthly * Math.max(1, m - 3),
          },
          isFrozen: false,
        };
      }
    }

    const annualStructure: AnnualStructureView = {
      ctc,
      basicAnnual: s.basicA,
      basicMonthly: s.basicM,
      hraAnnual: s.hraA,
      hraMonthly: s.hraM,
      specialAnnual: s.specialA,
      specialMonthly: s.specialM,
      eePfAnnual: s.eePfA,
      eePfMonthly: s.eePfM,
      erPfAnnual: s.erPfA,
      erPfMonthly: s.erPfM,
      gratuityAnnual: s.gratA,
      gratuityMonthly: s.gratM,
      grossAnnual: s.grossA,
      grossMonthly: s.grossM,
      variablePay,
      bonus,
      annualTax: tax.total,
    };

    const allMonths = fyMonths(currentMonthKey);
    const frozenSlips = await this.salaryRepository.findFrozenHistory(subjectId);
    const frozenMap = new Map<string, number>();
    for (const fs of frozenSlips) {
      frozenMap.set(fs.pay_month, Number(fs.net_pay));
    }

    const history: PayslipHistoryItem[] = [];

    for (const k of allMonths) {
      if (k < dojMonth) continue;
      if (dolMonth && k > dolMonth) continue;

      if (frozenMap.has(k)) {
        history.push({
          monthKey: k,
          monthLabel: monthLabel(k),
          netPay: frozenMap.get(k)!,
          status: "Paid",
        });
      } else {
        const monthNet = k === targetMonth && slip ? slip.netPay : Math.max(0, s.grossM - (s.eePfM + 200 + tax.monthly));
        history.push({
          monthKey: k,
          monthLabel: monthLabel(k),
          netPay: monthNet,
          status: "Generated",
        });
      }
    }

    history.reverse();

    return {
      slip,
      annualStructure,
      history,
      loan: loanView,
      company: {
        name: COMPANY_CONFIG.name,
        address: COMPANY_CONFIG.address,
        pan: COMPANY_CONFIG.pan,
        tan: COMPANY_CONFIG.tan,
        fy: COMPANY_CONFIG.fy,
        ay: COMPANY_CONFIG.ay,
      },
    };
  }
}
