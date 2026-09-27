import { RequestHandler } from "express";
import { ITaxService } from "./tax.service.interface";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware";
import { ApiError } from "../../utils/api-error";
import { asyncHandler } from "../../utils/async-handler";

export class TaxController {
  constructor(private readonly taxService: ITaxService) {}

  getMyTax: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const result = await this.taxService.getMyTax(employeeId);
    res.json({ success: true, data: result });
  });

  getEmployeeTax: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const subjectId = this.readId(req.params.id);
    const result = await this.taxService.getMyTax(employeeId, subjectId);
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
