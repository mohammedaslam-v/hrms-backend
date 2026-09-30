import { ReportCatalogItem, ReportFilterDto, ReportResult } from "./reports.model";

export interface IReportsService {
  getCatalog(actorId?: number): Promise<ReportCatalogItem[]> | ReportCatalogItem[];
  generateReport(filter: ReportFilterDto, actorId: number): Promise<ReportResult>;
  exportReportCsv(filter: ReportFilterDto, actorId: number): Promise<{ filename: string; csv: string }>;
}
