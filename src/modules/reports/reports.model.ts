export type ReportType =
  | 'attendance'
  | 'attsummary'
  | 'late'
  | 'nologin'
  | 'active'
  | 'salary'
  | 'income_tax'
  | 'loan'
  | 'loan_details'
  | 'net_pay'
  | 'pf'
  | 'provident_fund'
  | 'pt'
  | 'profession_tax'
  | 'tds'
  | 'appraisals'
  | 'all_employees'
  | 'recent_joinees'
  | 'recent_resignees'
  | 'leave'
  | 'goals'
  | 'basic';

export interface ReportColumn {
  key: string;
  label: string;
  align?: 'left' | 'center' | 'right';
  isNumeric?: boolean;
  isCurrency?: boolean;
  width?: string;
}

export interface ReportMeta {
  companyName: string;
  companyAddress: string;
  reportTitle: string;
  reportSubtitle?: string;
  periodLabel?: string;
  generatedAt: string;
  totalRecords: number;
  note?: string;
}

export interface ReportResult {
  type: ReportType;
  meta: ReportMeta;
  columns: ReportColumn[];
  rows: Record<string, any>[];
  totals?: Record<string, number | string>;
  note?: string;
}

export interface ReportFilterDto {
  type: ReportType;
  period?: 'daily' | 'weekly' | 'monthly' | 'range' | 'fytd';
  date?: string;
  week?: string;
  month?: string;
  from?: string;
  to?: string;
  state?: string;
  department?: string;
  employeeId?: number | string;
}

export interface ReportCatalogItem {
  type: ReportType;
  title: string;
  category: 'Attendance' | 'Payroll' | 'People';
  description: string;
  filterType: 'month' | 'range' | 'none' | 'month_state' | 'period';
}
