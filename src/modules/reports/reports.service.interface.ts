import { ReportCatalogItem, ReportFilterDto, ReportResult } from "./reports.model";
import { ActiveTimeView } from "./reports.active-time";

export interface IReportsService {
  getCatalog(actorId?: number): Promise<ReportCatalogItem[]> | ReportCatalogItem[];
  generateReport(filter: ReportFilterDto, actorId: number): Promise<ReportResult>;
  exportReportCsv(filter: ReportFilterDto, actorId: number): Promise<{ filename: string; csv: string }>;

  /**
   * Attendance & activity → Active time: panel active time and checked-in time
   * per person per day. Admins see everyone, managers their reporting tree.
   */
  getActiveTime(
    viewerId: number,
    options: { from: string; to: string; employeeIds?: number[]; department?: string },
  ): Promise<ActiveTimeView>;
}
