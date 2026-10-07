import { IAccessService } from "../access/access.service.interface";
import { IAuthService } from "../auth/auth.service.interface";
import { ICompensationService } from "../compensation/compensation.service.interface";
import { ApiError } from "../../utils/api-error";
import { payStructure } from "../salary/salary.domain";
import { computeTaxComputation, computeTdsSchedule, TAX_CONFIG } from "./tax.domain";
import { MyTaxResponse, TaxRegisterResponse, TaxRegisterRow } from "./tax.model";
import { ITaxRepository } from "./tax.repository.interface";
import { ITaxService } from "./tax.service.interface";

export class TaxService implements ITaxService {
  constructor(
    private readonly taxRepository: ITaxRepository,
    private readonly compensationService: ICompensationService,
    private readonly accessService: IAccessService,
    private readonly authService: IAuthService,
  ) {}

  async getMyTax(actorId: number, targetEmployeeId?: number): Promise<MyTaxResponse> {
    const subjectId = targetEmployeeId && targetEmployeeId > 0 ? targetEmployeeId : actorId;
    const access = await this.accessService.require(actorId, subjectId);
    if (access !== "self" && access !== "admin" && access !== "manager") {
      throw ApiError.forbidden("You do not have access to view tax details for this employee.");
    }

    const employee = await this.taxRepository.findEmployeeMeta(subjectId);
    if (!employee) {
      throw ApiError.notFound("Employee not found.");
    }

    const comp = await this.compensationService.getCurrent(subjectId);
    const ctc = comp ? comp.ctc : 0;
    const variablePay = comp ? comp.variablePay : 0;
    const bonus = comp ? comp.bonus : 0;

    let basicAnnual = 0;
    let hraAnnual = 0;
    let specialAnnual = 0;

    if (employee.isContractor) {
      basicAnnual = ctc;
      hraAnnual = 0;
      specialAnnual = 0;
    } else {
      const s = payStructure(ctc, comp?.components);
      basicAnnual = s.basicA;
      hraAnnual = s.hraA;
      specialAnnual = s.specialA;
    }

    const { computation, slabRows } = computeTaxComputation(
      basicAnnual,
      hraAnnual,
      specialAnnual,
      variablePay,
      bonus,
    );

    const actualDeducted = await this.taxRepository.findYtdTdsDeducted(
      subjectId,
      "2026-04",
      "2027-03",
    );

    const todayIso = new Date().toISOString().slice(0, 7);
    const schedule = computeTdsSchedule(
      computation.totalTax,
      computation.monthlyTds,
      todayIso,
      actualDeducted,
    );

    return {
      employee,
      computation,
      slabRows,
      schedule,
      company: {
        name: TAX_CONFIG.companyName,
        address: TAX_CONFIG.companyAddress,
        pan: TAX_CONFIG.pan,
        tan: TAX_CONFIG.tan,
        fy: TAX_CONFIG.fy,
        ay: TAX_CONFIG.ay,
      },
    };
  }

  /**
   * The Company TDS register — every employee's tax in one table.
   *
   * This is the basis of the quarterly Form 24Q, so the figures must be the
   * same ones the employee sees on their own page. They are: the same domain
   * functions run over the same inputs, only in bulk. There is no second
   * calculation here to drift from the first.
   *
   * Admin only, checked server-side. The rail hides the page from everyone
   * else, but a hidden link is a convenience and not access control.
   */
  async getCompanyRegister(actorId: number): Promise<TaxRegisterResponse> {
    const viewer = await this.authService.getCurrentEmployee(actorId);
    if (!viewer.tiers.includes("admin")) {
      throw ApiError.forbidden("The company TDS register is for admins only.");
    }

    const employees = await this.taxRepository.findAllEmployeeMeta();
    const ids = employees.map((e) => e.id);

    // Two bulk reads rather than two per person.
    const [pay, deducted] = await Promise.all([
      this.compensationService.getCurrentForMany(ids),
      this.taxRepository.findYtdTdsDeductedFor(ids, "2026-04", "2027-03"),
    ]);

    const rows: TaxRegisterRow[] = employees.map((employee) => {
      const comp = pay.get(employee.id);
      const ctc = comp ? comp.ctc : 0;
      const variablePay = comp ? comp.variablePay : 0;
      const bonus = comp ? comp.bonus : 0;

      // A contractor's whole fee is taxable; an employee's CTC splits first.
      const s = employee.isContractor
        ? { basicA: ctc, hraA: 0, specialA: 0 }
        : payStructure(ctc, comp?.components);

      const { computation } = computeTaxComputation(
        s.basicA,
        s.hraA,
        s.specialA,
        variablePay,
        bonus,
      );

      return {
        employeeId: employee.id,
        code: employee.code,
        name: employee.name,
        department: employee.department,
        pan: employee.pan,
        grossSalary: computation.grossSalary,
        stdDeduction: computation.stdDeduction,
        taxableIncome: computation.taxableIncome,
        slabTax: computation.slabTax,
        rebate87A: computation.rebate87A,
        cessAmount: computation.cessAmount,
        totalTax: computation.totalTax,
        monthlyTds: computation.monthlyTds,
        deductedTillDate: deducted.get(employee.id) ?? 0,
      };
    });

    const totals = rows.reduce(
      (acc, row) => ({
        people: acc.people + 1,
        grossSalary: acc.grossSalary + row.grossSalary,
        taxableIncome: acc.taxableIncome + row.taxableIncome,
        totalTax: acc.totalTax + row.totalTax,
        monthlyTds: acc.monthlyTds + row.monthlyTds,
        deductedTillDate: acc.deductedTillDate + row.deductedTillDate,
      }),
      { people: 0, grossSalary: 0, taxableIncome: 0, totalTax: 0, monthlyTds: 0, deductedTillDate: 0 },
    );

    const departments = [...new Set(rows.map((r) => r.department).filter(Boolean))].sort();

    return {
      rows,
      totals,
      departments,
      company: {
        name: TAX_CONFIG.companyName,
        address: TAX_CONFIG.companyAddress,
        pan: TAX_CONFIG.pan,
        tan: TAX_CONFIG.tan,
        fy: TAX_CONFIG.fy,
        ay: TAX_CONFIG.ay,
      },
      // Nobody has been paid through HRMS yet, so a column of zeroes is the
      // truth rather than a bug — but it needs saying, or it reads as "no tax
      // has been deducted all year".
      noPayslipsYet: totals.deductedTillDate === 0,
    };
  }
}
