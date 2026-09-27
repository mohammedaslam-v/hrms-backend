import { Request, Response } from 'express';
import { IReportsService } from './reports.service.interface';
import { ReportFilterDto, ReportType } from './reports.model';

export class ReportsController {
  constructor(private readonly reportsService: IReportsService) {}

  getCatalog = (_req: Request, res: Response): void => {
    const catalog = this.reportsService.getCatalog();
    res.json({ success: true, data: catalog });
  };

  getReportData = async (req: Request, res: Response): Promise<void> => {
    try {
      const type = (req.query.type as ReportType) || 'all_employees';
      const month = req.query.month as string | undefined;
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const state = req.query.state as string | undefined;
      const department = req.query.department as string | undefined;

      const actorId = (req as any).user?.id || 1;

      const filter: ReportFilterDto = { type, month, from, to, state, department };
      const report = await this.reportsService.generateReport(filter, actorId);

      res.json({ success: true, data: report });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to generate report' });
    }
  };

  exportReport = async (req: Request, res: Response): Promise<void> => {
    try {
      const type = (req.query.type as ReportType) || 'all_employees';
      const month = req.query.month as string | undefined;
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const state = req.query.state as string | undefined;
      const department = req.query.department as string | undefined;

      const actorId = (req as any).user?.id || 1;

      const filter: ReportFilterDto = { type, month, from, to, state, department };
      const { filename, csv } = await this.reportsService.exportReportCsv(filter, actorId);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.status(200).send(csv);
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to export report' });
    }
  };
}
