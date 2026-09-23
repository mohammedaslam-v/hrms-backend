import { RequestHandler } from "express";
import { ISalaryService } from "./salary.service.interface";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware";
import { ApiError } from "../../utils/api-error";
import { asyncHandler } from "../../utils/async-handler";

export class SalaryController {
  constructor(private readonly salaryService: ISalaryService) {}

  getMySalary: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const month = typeof req.query.month === "string" ? req.query.month : undefined;
    const result = await this.salaryService.getMySalary(employeeId, employeeId, month);
    res.json({ success: true, data: result });
  });

  getEmployeeSalary: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const subjectId = this.readId(req.params.id);
    const month = typeof req.query.month === "string" ? req.query.month : undefined;
    const result = await this.salaryService.getMySalary(employeeId, subjectId, month);
    res.json({ success: true, data: result });
  });

  private readId(raw: unknown): number {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      throw ApiError.badRequest("id must be a positive integer");
    }
    return id;
  }
}
