import { IAccessService } from "../access/access.service.interface";
import { ICompensationService } from "../compensation/compensation.service.interface";
import { ApiError } from "../../utils/api-error";
import { structure } from "../salary/salary.domain";
import { computeTaxComputation, computeTdsSchedule, TAX_CONFIG } from "./tax.domain";
import { MyTaxResponse } from "./tax.model";
import { ITaxRepository } from "./tax.repository.interface";
import { ITaxService } from "./tax.service.interface";

export class TaxService implements ITaxService {
  constructor(
    private readonly taxRepository: ITaxRepository,
    private readonly compensationService: ICompensationService,
    private readonly accessService: IAccessService,
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
      const s = structure(ctc);
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
}
