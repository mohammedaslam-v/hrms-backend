import { ReportCatalogItem, ReportFilterDto, ReportResult } from "./reports.model";
import { ActiveTimeView } from "./reports.active-time";
import { ActivitiesView } from "./reports.activities";

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

  /**
   * Attendance & activity → Activities: per person per day, panel time and the
   * activities they recorded. Admins see everyone; managers their direct
   * reports, plus Sales/Operations people two levels down.
   */
  getActivities(
    viewerId: number,
    options: { from: string; to: string; employeeIds?: number[]; department?: string },
  ): Promise<ActivitiesView>;
}
