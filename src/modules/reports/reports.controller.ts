import { Request, Response } from "express";
import { IReportsService } from "./reports.service.interface";
import { ReportFilterDto, ReportType } from "./reports.model";
import { AuthenticatedRequest } from "../../middlewares/auth.middleware";

export class ReportsController {
  constructor(private readonly reportsService: IReportsService) {}

  getCatalog = async (req: Request, res: Response): Promise<void> => {
    try {
      const actorId = (req as AuthenticatedRequest).employeeId || (req as any).user?.id || 1;
      const catalog = await this.reportsService.getCatalog(actorId);
      res.json({ success: true, data: catalog });
    } catch (err: any) {
      const status = err.statusCode || 400;
      res.status(status).json({ success: false, message: err.message || "Failed to get catalog" });
    }
  };

  getReportData = async (req: Request, res: Response): Promise<void> => {
    try {
      const type = (req.query.type as ReportType) || "all_employees";
      const period = req.query.period as any;
      const date = req.query.date as string | undefined;
      const week = req.query.week as string | undefined;
      const month = req.query.month as string | undefined;
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const state = req.query.state as string | undefined;
      const department = req.query.department as string | undefined;
      const employeeId = req.query.employeeId as string | undefined;

      const actorId = (req as AuthenticatedRequest).employeeId || (req as any).user?.id || 1;

      const filter: ReportFilterDto = {
        type,
        period,
        date,
        week,
        month,
        from,
        to,
        state,
        department,
        employeeId,
      };
      const report = await this.reportsService.generateReport(filter, actorId);

      res.json({ success: true, data: report });
    } catch (err: any) {
      const status = err.statusCode || 400;
      res.status(status).json({ success: false, message: err.message || "Failed to generate report" });
    }
  };

  exportReport = async (req: Request, res: Response): Promise<void> => {
    try {
      const type = (req.query.type as ReportType) || "all_employees";
      const period = req.query.period as any;
      const date = req.query.date as string | undefined;
      const week = req.query.week as string | undefined;
      const month = req.query.month as string | undefined;
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const state = req.query.state as string | undefined;
      const department = req.query.department as string | undefined;
      const employeeId = req.query.employeeId as string | undefined;
      // The screen's search box, so the download matches the table.
      const search = req.query.search as string | undefined;

      const actorId = (req as AuthenticatedRequest).employeeId || (req as any).user?.id || 1;

      const filter: ReportFilterDto = {
        type,
        period,
        date,
        week,
        month,
        from,
        to,
        state,
        department,
        employeeId,
        search,
      };
      const { filename, csv } = await this.reportsService.exportReportCsv(filter, actorId);

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.status(200).send(csv);
    } catch (err: any) {
      const status = err.statusCode || 400;
      res.status(status).json({ success: false, message: err.message || "Failed to export report" });
    }
  };
}
