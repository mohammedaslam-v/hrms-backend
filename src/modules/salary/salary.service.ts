import { ApiError } from "../../utils/api-error";
import { IAccessService } from "../access/access.service.interface";
import { ICompensationService } from "../compensation/compensation.service.interface";
import {
  COMPANY_CONFIG,
  computeTax,
  fyMonths,
  monthLabel,
  ptFor,
  structure,
  words,
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
  ) {}

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

    const activeLoan = await this.salaryRepository.findActiveLoan(subjectId);
    let loanEmi = 0;
    let loanView: EmployeeLoanView | null = null;

    if (activeLoan) {
      const [sy, sm] = activeLoan.start_month.split("-").map(Number);
      const monthsElapsed = (y - sy) * 12 + (m - sm);
      if (monthsElapsed >= 0 && monthsElapsed < activeLoan.tenure_months) {
        loanEmi = Number(activeLoan.emi);
      }

      const totalMonthsElapsed = Math.max(0, (y - sy) * 12 + (m - sm) + 1);
      const paidMonths = Math.min(activeLoan.tenure_months, totalMonthsElapsed);
      const repaid = Math.min(Number(activeLoan.principal), paidMonths * Number(activeLoan.emi));
      const outstanding = Math.max(0, Number(activeLoan.principal) - repaid);

      const endM = sm + activeLoan.tenure_months - 1;
      const endYear = sy + Math.floor((endM - 1) / 12);
      const endMonthNum = ((endM - 1) % 12) + 1;
      const finalMonthKey = `${endYear}-${String(endMonthNum).padStart(2, "0")}`;

      loanView = {
        id: activeLoan.id,
        purpose: activeLoan.purpose,
        principal: Number(activeLoan.principal),
        emi: Number(activeLoan.emi),
        interestRate: Number(activeLoan.interest_rate),
        startMonth: activeLoan.start_month,
        tenureMonths: activeLoan.tenure_months,
        paidMonths,
        repaidAmount: repaid,
        outstandingAmount: outstanding,
        finalMonth: monthLabel(finalMonthKey),
        status: activeLoan.status,
      };
    }

    const dojMonth = emp.dateOfJoining ? emp.dateOfJoining.slice(0, 7) : "1970-01";
    const dolMonth = emp.dateOfLeaving ? emp.dateOfLeaving.slice(0, 7) : null;
    const isPaidInMonth = targetMonth >= dojMonth && (!dolMonth || targetMonth <= dolMonth);

    const frozenSlip = await this.salaryRepository.findFrozenPayslip(subjectId, targetMonth);
    const s = structure(ctc);
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
          workState: emp.workState,
        },
        earnings: {
          basic: Number(frozenSlip.basic),
          hra: Number(frozenSlip.hra),
          special: Number(frozenSlip.special_allowance),
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
      const lopDays = await this.salaryRepository.findApprovedLopDays(subjectId, targetMonth);
      const payableDays = Math.max(0, monthDays - lopDays);
      const factor = monthDays > 0 ? payableDays / monthDays : 1;

      if (emp.isContractor) {
        const monthlyRetainer = Math.round(ctc / 12);
        const gross = Math.round(monthlyRetainer * factor);
        const tds = Math.round(gross * 0.10);
        const net = Math.max(0, gross - tds - loanEmi);
        const totalDeductions = tds + loanEmi;

        slip = {
          payMonth: targetMonth,
          monthLabel: monthLabel(targetMonth),
          monthDays,
          payableDays,
          lopDays,
          lopAmount: Math.round((monthlyRetainer / monthDays) * lopDays),
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
            workState: emp.workState,
          },
          earnings: {
            basic: gross,
            hra: 0,
            special: 0,
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
        const gross = basic + hra + special;

        const pt = ptFor(emp.workState, s.grossM, targetMonth);
        const eePf = Math.min(Math.round(basic * 0.12), 1800);
        const tds = tax.monthly;
        const totalDeductions = eePf + pt + tds + loanEmi;
        const net = Math.max(0, gross - totalDeductions);

        slip = {
          payMonth: targetMonth,
          monthLabel: monthLabel(targetMonth),
          monthDays,
          payableDays,
          lopDays,
          lopAmount: Math.round((s.grossM / monthDays) * lopDays),
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
            workState: emp.workState,
          },
          earnings: {
            basic,
            hra,
            special,
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
