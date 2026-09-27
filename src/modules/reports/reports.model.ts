export type ReportType =
  | 'all_employees'
  | 'income_tax'
  | 'loan_details'
  | 'net_pay'
  | 'provident_fund'
  | 'profession_tax'
  | 'recent_joinees'
  | 'recent_resignees'
  | 'appraisals';

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
}

export interface ReportResult {
  type: ReportType;
  meta: ReportMeta;
  columns: ReportColumn[];
  rows: Record<string, any>[];
  totals?: Record<string, number | string>;
}

export interface ReportFilterDto {
  type: ReportType;
  month?: string;
  from?: string;
  to?: string;
  state?: string;
  department?: string;
}

export interface ReportCatalogItem {
  type: ReportType;
  title: string;
  category: 'Statutory & Tax' | 'Banking & Payroll' | 'People & Lifecycle';
  description: string;
  filterType: 'month' | 'range' | 'none' | 'month_state';
}
