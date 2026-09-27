import {
  ReportCatalogItem,
  ReportColumn,
  ReportFilterDto,
  ReportResult,
} from './reports.model';
import { IReportsRepository } from './reports.repository.interface';
import { IReportsService } from './reports.service.interface';
import { ICompensationService } from '../compensation/compensation.service.interface';
import { structure } from '../salary/salary.domain';
import { computeTaxComputation } from '../tax/tax.domain';
import { ptFor } from '../salary/salary.domain';

const COMPANY_HEADER = {
  name: 'BAMBINOS LEARNING SOLUTIONS PRIVATE LIMITED',
  address:
    '36/5, Hustlehub Tech Park, Somasundarapalya Main Rd, Adjacent 27th Main Road, ITI Layout, Sector 2, HSR Layout, Haralukunte Village Bengaluru, Bengaluru, Karnataka 560102',
};

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

function formatMonthLabel(mKey: string): string {
  const parts = mKey.split('-');
  if (parts.length < 2) return mKey;
  const m = Number(parts[1]);
  return `${MONTH_NAMES[m - 1] || ''} ${parts[0]}`;
}

function getLastDayOfMonth(mKey: string): string {
  const [year, month] = mKey.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const mStr = String(month).padStart(2, '0');
  return `${year}-${mStr}-${String(lastDay).padStart(2, '0')}`;
}

function calculateTenure(fromStr: string, toStr: string): string {
  const from = new Date(fromStr);
  const to = new Date(toStr);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return '—';

  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months--;
  months = Math.max(0, months);

  const yrs = Math.floor(months / 12);
  const remMos = months % 12;

  if (yrs === 0) return `${remMos} mo${remMos !== 1 ? 's' : ''}`;
  if (remMos === 0) return `${yrs} yr${yrs !== 1 ? 's' : ''}`;
  return `${yrs} yr${yrs !== 1 ? 's' : ''} ${remMos} mo${remMos !== 1 ? 's' : ''}`;
}

export class ReportsService implements IReportsService {
  constructor(
    private readonly repository: IReportsRepository,
    private readonly compensationService: ICompensationService,
  ) {}

  getCatalog(): ReportCatalogItem[] {
    return [
      {
        type: 'all_employees',
        title: 'All Active Employees Report',
        category: 'People & Lifecycle',
        description: 'Directory list of all currently active company employees.',
        filterType: 'none',
      },
      {
        type: 'income_tax',
        title: 'Income Tax Monthly Statement',
        category: 'Statutory & Tax',
        description: 'Monthly TDS computation, taxable income, slab tax, and cess statement.',
        filterType: 'month',
      },
      {
        type: 'loan_details',
        title: 'Loan Details Report',
        category: 'Banking & Payroll',
        description: 'Company loans tracking: opening balance, monthly EMI, closing balance, and tenure.',
        filterType: 'month',
      },
      {
        type: 'net_pay',
        title: 'Net Pay Report (Bank Disbursement Advice)',
        category: 'Banking & Payroll',
        description: 'Bank payout file with zero-padding protection for account numbers, IFSC, and net salary.',
        filterType: 'month',
      },
      {
        type: 'provident_fund',
        title: 'Provident Fund (PF) Monthly Statement',
        category: 'Statutory & Tax',
        description: 'PF statutory statement covering Employee (12%) and Employer (EPF + EPS) contributions.',
        filterType: 'month',
      },
      {
        type: 'profession_tax',
        title: 'Profession Tax (PT) Monthly Statement',
        category: 'Statutory & Tax',
        description: 'State-wise monthly professional tax deduction schedule and gross base.',
        filterType: 'month_state',
      },
      {
        type: 'recent_joinees',
        title: 'Recent Joinees Report',
        category: 'People & Lifecycle',
        description: 'Newly onboarded employees with probation dates, manager hierarchy, and experience bracket.',
        filterType: 'range',
      },
      {
        type: 'recent_resignees',
        title: 'Recent Resignees Report',
        category: 'People & Lifecycle',
        description: 'Exited staff members, notice status, years in service, PAN, UAN, and exit dates.',
        filterType: 'range',
      },
      {
        type: 'appraisals',
        title: 'Appraisal & Increment Report',
        category: 'Banking & Payroll',
        description: 'Compensation revisions, increment amount, percentage hike, and revised annual CTC.',
        filterType: 'range',
      },
    ];
  }

  async generateReport(filter: ReportFilterDto, _actorId: number): Promise<ReportResult> {
    switch (filter.type) {
      case 'all_employees':
        return this.buildAllEmployees(filter);
      case 'income_tax':
        return this.buildIncomeTax(filter);
      case 'loan_details':
        return this.buildLoanDetails(filter);
      case 'net_pay':
        return this.buildNetPay(filter);
      case 'provident_fund':
        return this.buildProvidentFund(filter);
      case 'profession_tax':
        return this.buildProfessionTax(filter);
      case 'recent_joinees':
        return this.buildRecentJoinees(filter);
      case 'recent_resignees':
        return this.buildRecentResignees(filter);
      case 'appraisals':
        return this.buildAppraisals(filter);
      default:
        throw new Error(`Unsupported report type: ${filter.type}`);
    }
  }

  // 1. All Active Employees Report
  private async buildAllEmployees(filter: ReportFilterDto): Promise<ReportResult> {
    const employees = await this.repository.findActiveEmployees(filter.department);

    const columns: ReportColumn[] = [
      { key: 'empId', label: 'Emp ID', width: '120px' },
      { key: 'empName', label: 'Emp Name', width: '220px' },
      { key: 'email', label: 'Email ID', width: '240px' },
      { key: 'designation', label: 'Designation', width: '200px' },
      { key: 'department', label: 'Department', width: '180px' },
    ];

    const rows = employees.map((e) => ({
      empId: e.employee_code,
      empName: e.full_name,
      email: e.work_email,
      designation: e.designation || 'Associate',
      department: e.department || 'General',
    }));

    return {
      type: 'all_employees',
      meta: {
        companyName: COMPANY_HEADER.name,
        companyAddress: COMPANY_HEADER.address,
        reportTitle: 'All Active Employees Report',
        generatedAt: new Date().toISOString(),
        totalRecords: rows.length,
      },
      columns,
      rows,
      totals: {
        empId: 'Total Active',
        empName: `${rows.length} Employees`,
      },
    };
  }

  // 2. Income Tax Monthly Statement
  private async buildIncomeTax(filter: ReportFilterDto): Promise<ReportResult> {
    const month = filter.month || '2026-08';
    const employees = await this.repository.findActiveEmployees(filter.department);
    const ids = employees.map((e) => e.id);
    const compMap = await this.compensationService.getCurrentForMany(ids);

    const columns: ReportColumn[] = [
      { key: 'siNo', label: 'SI No', width: '60px', isNumeric: true },
      { key: 'employeeNo', label: 'Employee No', width: '120px' },
      { key: 'name', label: 'Name', width: '200px' },
      { key: 'joinDate', label: 'Join Date', width: '120px' },
      { key: 'panNo', label: 'PAN No', width: '130px' },
      { key: 'panStatus', label: 'Pan Status', width: '140px' },
      { key: 'taxRegime', label: 'Tax Regime', width: '100px' },
      { key: 'taxableIncome', label: 'Taxable Income', isNumeric: true, isCurrency: true },
      { key: 'incomeTax', label: 'Income Tax', isNumeric: true, isCurrency: true },
      { key: 'surcharge', label: 'Surcharge', isNumeric: true, isCurrency: true },
      { key: 'cess', label: 'Cess', isNumeric: true, isCurrency: true },
      { key: 'tdsTaxableIncome', label: 'TDS Taxable Income', isNumeric: true, isCurrency: true },
      { key: 'tdsIncomeTax', label: 'TDS Income Tax', isNumeric: true, isCurrency: true },
      { key: 'tdsSurcharge', label: 'TDS Surcharge', isNumeric: true, isCurrency: true },
      { key: 'tdsCess', label: 'TDS Cess', isNumeric: true, isCurrency: true },
      { key: 'totalTax', label: 'Total Tax', isNumeric: true, isCurrency: true },
    ];

    let totalTaxable = 0;
    let totalIncomeTax = 0;
    let totalCess = 0;
    let totalTaxSum = 0;

    const rows = employees.map((e, index) => {
      const comp = compMap.get(e.id);
      const ctc = comp ? comp.ctc : 600000;
      const s = structure(ctc);
      const monthlyGross = Math.round(ctc / 12);

      const isContractor = (e.employment_type || '').toLowerCase().includes('contract');
      const struct = isContractor
        ? { basicA: ctc, hraA: 0, specialA: 0 }
        : { basicA: s.basicA, hraA: s.hraA, specialA: s.specialA };

      const taxComp = computeTaxComputation(
        struct.basicA,
        struct.hraA,
        struct.specialA,
        comp?.variablePay ?? 0,
        comp?.bonus ?? 0,
      );

      const monthlyTds = taxComp.computation.monthlyTds;
      const monthlyBaseTax = Math.round(monthlyTds / 1.04);
      const monthlyCess = monthlyTds - monthlyBaseTax;

      totalTaxable += monthlyGross;
      totalIncomeTax += monthlyBaseTax;
      totalCess += monthlyCess;
      totalTaxSum += monthlyTds;

      const panStatus = e.pan && e.pan.trim().length === 10 ? 'PAN AVAILABLE' : '';

      return {
        siNo: index + 1,
        employeeNo: e.employee_code.replace('BAM-', ''),
        name: e.full_name,
        joinDate: e.date_of_joining,
        panNo: e.pan || '—',
        panStatus,
        taxRegime: 'NEW',
        taxableIncome: monthlyGross,
        incomeTax: monthlyBaseTax,
        surcharge: 0,
        cess: monthlyCess,
        tdsTaxableIncome: 0,
        tdsIncomeTax: 0,
        tdsSurcharge: 0,
        tdsCess: 0,
        totalTax: monthlyTds,
      };
    });

    return {
      type: 'income_tax',
      meta: {
        companyName: COMPANY_HEADER.name,
        companyAddress: COMPANY_HEADER.address,
        reportTitle: `Income Tax Statement For The Month ${formatMonthLabel(month)}`,
        reportSubtitle: 'For Location Bangalore',
        periodLabel: month,
        generatedAt: new Date().toISOString(),
        totalRecords: rows.length,
      },
      columns,
      rows,
      totals: {
        name: 'Total',
        taxableIncome: totalTaxable,
        incomeTax: totalIncomeTax,
        surcharge: 0,
        cess: totalCess,
        totalTax: totalTaxSum,
      },
    };
  }

  // 3. Loan Details Report
  private async buildLoanDetails(filter: ReportFilterDto): Promise<ReportResult> {
    const month = filter.month || '2026-08';
    const loans = await this.repository.findLoans();

    const columns: ReportColumn[] = [
      { key: 'groupBy', label: 'Group By', width: '120px' },
      { key: 'employeeName', label: 'Employee Name', width: '180px' },
      { key: 'employeeNo', label: 'Employee No', width: '120px' },
      { key: 'dateOfJoining', label: 'Date of Joining', width: '120px' },
      { key: 'openingBalance', label: 'Opening Balance of Loan', isNumeric: true, isCurrency: true },
      { key: 'loanType', label: 'Loan Type', width: '130px' },
      { key: 'loanAmount', label: 'Loan Amount', isNumeric: true, isCurrency: true },
      { key: 'loanDeductFrom', label: 'Loan Deduct From (Period)', width: '140px' },
      { key: 'loanPeriod', label: 'Loan Period (In months)', isNumeric: true },
      { key: 'closingBalance', label: 'Closing Balance', isNumeric: true, isCurrency: true },
      { key: 'interestRate', label: 'Interest Rate', isNumeric: true },
      { key: 'perquisiteRate', label: 'Perquisite Rate', isNumeric: true },
      { key: 'monthPrincipal', label: `${formatMonthLabel(month)} Principal`, isNumeric: true, isCurrency: true },
      { key: 'monthInterest', label: `${formatMonthLabel(month)} Interest`, isNumeric: true, isCurrency: true },
      { key: 'monthPerquisite', label: `${formatMonthLabel(month)} Perquisite`, isNumeric: true, isCurrency: true },
      { key: 'remainingMonths', label: 'Remaining Months', isNumeric: true },
      { key: 'totalPrincipal', label: 'Total Principal Repaid', isNumeric: true, isCurrency: true },
      { key: 'totalInterest', label: 'Total Interest', isNumeric: true, isCurrency: true },
      { key: 'totalPerquisite', label: 'Total Perquisite', isNumeric: true, isCurrency: true },
      { key: 'status', label: 'Status', width: '100px' },
      { key: 'remarks', label: 'Remarks', width: '220px' },
    ];

    let sumLoanAmount = 0;
    let sumOpening = 0;
    let sumClosing = 0;
    let sumMonthPrincipal = 0;
    let sumTotalRepaid = 0;

    const rows = loans.map((loan) => {
      const principal = Number(loan.principal);
      const emi = Number(loan.emi);
      const tenure = Number(loan.tenure_months);

      // Month difference between loan.start_month and current month
      const startParts = (loan.start_month || '2026-04').split('-').map(Number);
      const currParts = month.split('-').map(Number);

      const elapsed = Math.max(0, (currParts[0] - startParts[0]) * 12 + (currParts[1] - startParts[1]));
      const opening = Math.max(0, principal - elapsed * emi);
      const isDeductingThisMonth = opening > 0 && elapsed <= tenure;
      const monthPrincipal = isDeductingThisMonth ? Math.min(opening, emi) : 0;
      const closing = Math.max(0, opening - monthPrincipal);
      const completedMonths = Math.min(tenure, elapsed + (monthPrincipal > 0 ? 1 : 0));
      const remainingMonths = Math.max(0, tenure - completedMonths);
      const totalRepaid = Math.min(principal, completedMonths * emi);

      sumLoanAmount += principal;
      sumOpening += opening;
      sumClosing += closing;
      sumMonthPrincipal += monthPrincipal;
      sumTotalRepaid += totalRepaid;

      return {
        groupBy: loan.work_state || 'Bangalore',
        employeeName: loan.employee_name,
        employeeNo: loan.employee_code.replace('BAM-', ''),
        dateOfJoining: loan.date_of_joining,
        openingBalance: opening,
        loanType: 'Flat Interest',
        loanAmount: principal,
        loanDeductFrom: formatMonthLabel(loan.start_month || '2026-04'),
        loanPeriod: tenure,
        closingBalance: closing,
        interestRate: 0,
        perquisiteRate: 0,
        monthPrincipal,
        monthInterest: 0,
        monthPerquisite: 0,
        remainingMonths,
        totalPrincipal: totalRepaid,
        totalInterest: 0,
        totalPerquisite: 0,
        status: closing === 0 ? 'Closed' : 'Active',
        remarks: loan.purpose || 'Personal Loan',
      };
    });

    return {
      type: 'loan_details',
      meta: {
        companyName: COMPANY_HEADER.name,
        companyAddress: COMPANY_HEADER.address,
        reportTitle: `Loan Detailed Report From 01 ${formatMonthLabel(month)} to ${getLastDayOfMonth(month)}`,
        periodLabel: month,
        generatedAt: new Date().toISOString(),
        totalRecords: rows.length,
      },
      columns,
      rows,
      totals: {
        employeeName: 'Total',
        loanAmount: sumLoanAmount,
        openingBalance: sumOpening,
        closingBalance: sumClosing,
        monthPrincipal: sumMonthPrincipal,
        totalPrincipal: sumTotalRepaid,
      },
    };
  }

  // 4. Net Pay Report (Bank Disbursement Advice)
  private async buildNetPay(filter: ReportFilterDto): Promise<ReportResult> {
    const month = filter.month || '2026-08';
    const employees = await this.repository.findActiveEmployees(filter.department);
    const ids = employees.map((e) => e.id);
    const compMap = await this.compensationService.getCurrentForMany(ids);
    const loans = await this.repository.findLoans();
    const loanMap = new Map<number, number>();
    for (const l of loans) {
      if (l.status === 'active') loanMap.set(l.employee_id, Number(l.emi));
    }

    const columns: ReportColumn[] = [
      { key: 'beneficiaryName', label: 'Beneficiary Name', width: '220px' },
      { key: 'beneficiaryAccountNo', label: 'Beneficiary Account Number', width: '220px' },
      { key: 'ifscCode', label: 'IFSC Code', width: '140px' },
      { key: 'payoutAmount', label: 'Payout Amount', isNumeric: true, isCurrency: true },
      { key: 'payoutMode', label: 'Payout Mode', width: '100px' },
      { key: 'payoutNarration', label: 'Payout Narration', width: '220px' },
      { key: 'notes', label: 'Notes', width: '180px' },
      { key: 'phone', label: 'Phone Number', width: '140px' },
      { key: 'email', label: 'Email ID', width: '240px' },
    ];

    let totalPayout = 0;

    const rows = employees.map((e) => {
      const comp = compMap.get(e.id);
      const ctc = comp ? comp.ctc : 600000;
      const s = structure(ctc);
      const gross = Math.round(ctc / 12);
      const pf = s.eePfM;
      const pt = ptFor(e.work_state || 'Karnataka', gross);
      const loanEmi = loanMap.get(e.id) ?? 0;

      const taxComp = computeTaxComputation(s.basicA, s.hraA, s.specialA, comp?.variablePay ?? 0, comp?.bonus ?? 0);
      const tds = taxComp.computation.monthlyTds;

      const netPay = Math.max(0, gross - (pf + pt + tds + loanEmi));
      totalPayout += netPay;

      const rawAccount = e.account_no || '001234567890';

      return {
        beneficiaryName: e.full_name,
        beneficiaryAccountNo: rawAccount,
        ifscCode: e.ifsc_code || 'HDFC0000128',
        payoutAmount: netPay,
        payoutMode: 'NEFT',
        payoutNarration: `Salary ${formatMonthLabel(month)} - ${e.employee_code}`,
        notes: 'Regular Monthly Payroll',
        phone: e.phone || '—',
        email: e.work_email,
      };
    });

    return {
      type: 'net_pay',
      meta: {
        companyName: COMPANY_HEADER.name,
        companyAddress: COMPANY_HEADER.address,
        reportTitle: `Net Pay Payout Statement — ${formatMonthLabel(month)}`,
        reportSubtitle: 'Ensuring 100% Leading Zero Preservation for Corporate Banking Uploads',
        periodLabel: month,
        generatedAt: new Date().toISOString(),
        totalRecords: rows.length,
      },
      columns,
      rows,
      totals: {
        beneficiaryName: 'Total Disbursement',
        payoutAmount: totalPayout,
      },
    };
  }

  // 5. Provident Fund (PF) Monthly Statement
  private async buildProvidentFund(filter: ReportFilterDto): Promise<ReportResult> {
    const month = filter.month || '2026-08';
    const employees = await this.repository.findActiveEmployees(filter.department);
    const ids = employees.map((e) => e.id);
    const compMap = await this.compensationService.getCurrentForMany(ids);

    const columns: ReportColumn[] = [
      { key: 'siNo', label: 'SI No', width: '60px', isNumeric: true },
      { key: 'employeeNo', label: 'Employee No', width: '120px' },
      { key: 'name', label: 'Name', width: '220px' },
      { key: 'pfNo', label: 'PF No', width: '160px' },
      { key: 'basicDa', label: 'Basic + DA', isNumeric: true, isCurrency: true },
      { key: 'employeePf', label: "Employees' Contribution PF", isNumeric: true, isCurrency: true },
      { key: 'employeeVpf', label: "Employees' Contribution VPF", isNumeric: true, isCurrency: true },
      { key: 'employerPf', label: "Employers' Contribution PF", isNumeric: true, isCurrency: true },
      { key: 'employerEps', label: "Employers' Contribution EPS", isNumeric: true, isCurrency: true },
      { key: 'employerTotal', label: "Employers' Contribution Total", isNumeric: true, isCurrency: true },
    ];

    let totalBasic = 0;
    let totalEmpPf = 0;
    let totalEmprPf = 0;
    let totalEmprEps = 0;
    let totalEmprTotal = 0;

    const rows = employees.map((e, index) => {
      const comp = compMap.get(e.id);
      const ctc = comp ? comp.ctc : 600000;
      const s = structure(ctc);

      const pfBasic = Math.min(s.basicM, 15000);
      const empPf = s.eePfM;
      const empVpf = 0;
      const emprEps = s.epsM;
      const emprPf = s.erEpfM;
      const emprTotal = s.erPfM;

      totalBasic += pfBasic;
      totalEmpPf += empPf;
      totalEmprPf += emprPf;
      totalEmprEps += emprEps;
      totalEmprTotal += emprTotal;

      return {
        siNo: index + 1,
        employeeNo: e.employee_code.replace('BAM-', ''),
        name: e.full_name,
        pfNo: e.pf_number || e.uan || '—',
        basicDa: pfBasic,
        employeePf: empPf,
        employeeVpf: empVpf,
        employerPf: emprPf,
        employerEps: emprEps,
        employerTotal: emprTotal,
      };
    });

    return {
      type: 'provident_fund',
      meta: {
        companyName: COMPANY_HEADER.name,
        companyAddress: COMPANY_HEADER.address,
        reportTitle: `Provident Fund Statement For ${formatMonthLabel(month)}`,
        reportSubtitle: 'For Location Bangalore',
        periodLabel: month,
        generatedAt: new Date().toISOString(),
        totalRecords: rows.length,
      },
      columns,
      rows,
      totals: {
        name: 'Total',
        basicDa: totalBasic,
        employeePf: totalEmpPf,
        employeeVpf: 0,
        employerPf: totalEmprPf,
        employerEps: totalEmprEps,
        employerTotal: totalEmprTotal,
      },
    };
  }

  // 6. Profession Tax (PT) Monthly Statement
  private async buildProfessionTax(filter: ReportFilterDto): Promise<ReportResult> {
    const month = filter.month || '2026-08';
    const state = filter.state || 'Karnataka';
    const employees = await this.repository.findActiveEmployees(filter.department);
    const ids = employees.map((e) => e.id);
    const compMap = await this.compensationService.getCurrentForMany(ids);

    const columns: ReportColumn[] = [
      { key: 'srNo', label: 'Sr. No.', width: '70px', isNumeric: true },
      { key: 'employeeNo', label: 'Employee No', width: '120px' },
      { key: 'name', label: 'Name', width: '220px' },
      { key: 'profTaxBasic', label: 'Prof Tax Basic', isNumeric: true, isCurrency: true },
      { key: 'amount', label: 'Amount', isNumeric: true, isCurrency: true },
    ];

    let totalBasic = 0;
    let totalPt = 0;

    const rows = employees.map((e, index) => {
      const comp = compMap.get(e.id);
      const ctc = comp ? comp.ctc : 600000;
      const gross = Math.round(ctc / 12);
      const pt = ptFor(state, gross);

      totalBasic += gross;
      totalPt += pt;

      return {
        srNo: index + 1,
        employeeNo: e.employee_code.replace('BAM-', ''),
        name: e.full_name,
        profTaxBasic: gross,
        amount: pt,
      };
    });

    return {
      type: 'profession_tax',
      meta: {
        companyName: COMPANY_HEADER.name,
        companyAddress: COMPANY_HEADER.address,
        reportTitle: `STATEMENT OF PROFESSION TAX FOR ${formatMonthLabel(month)} (${state})`,
        periodLabel: month,
        generatedAt: new Date().toISOString(),
        totalRecords: rows.length,
      },
      columns,
      rows,
      totals: {
        name: 'Total',
        profTaxBasic: totalBasic,
        amount: totalPt,
      },
    };
  }

  // 7. Recent Joinee Report
  private async buildRecentJoinees(filter: ReportFilterDto): Promise<ReportResult> {
    const today = new Date();
    const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
    const from = filter.from || ninetyDaysAgo.toISOString().split('T')[0];
    const to = filter.to || today.toISOString().split('T')[0];

    const employees = await this.repository.findRecentJoinees(from, to, filter.department);

    const columns: ReportColumn[] = [
      { key: 'empId', label: 'Emp ID', width: '120px' },
      { key: 'empName', label: 'Emp Name', width: '200px' },
      { key: 'doj', label: 'Date of Joining', width: '130px' },
      { key: 'gender', label: 'Gender', width: '100px' },
      { key: 'email', label: 'Email ID', width: '220px' },
      { key: 'status', label: 'Status', width: '120px' },
      { key: 'confirmationDate', label: 'Confirmation Date', width: '150px' },
      { key: 'managerId', label: 'Manager ID', width: '120px' },
      { key: 'managerName', label: 'Manager Name', width: '180px' },
      { key: 'phone', label: 'Phone Number', width: '130px' },
      { key: 'totalExp', label: 'Total Exp Range', width: '140px' },
    ];

    const rows = employees.map((e) => {
      // If confirmation_date is null, default to doj + 6 months
      let confDate = e.confirmation_date;
      if (!confDate && e.date_of_joining) {
        const d = new Date(e.date_of_joining);
        d.setMonth(d.getMonth() + 6);
        confDate = d.toISOString().split('T')[0];
      }

      return {
        empId: e.employee_code,
        empName: e.full_name,
        doj: e.date_of_joining,
        gender: e.gender || '—',
        email: e.work_email,
        status: 'Active',
        confirmationDate: confDate || '—',
        managerId: e.manager_code || (e.manager_id ? `BAM-${String(e.manager_id).padStart(4, '0')}` : '—'),
        managerName: e.manager_name || '—',
        phone: e.phone || '—',
        totalExp: e.total_experience || '1-3 yrs',
      };
    });

    return {
      type: 'recent_joinees',
      meta: {
        companyName: COMPANY_HEADER.name,
        companyAddress: COMPANY_HEADER.address,
        reportTitle: `Recent Joinee Report (${from} to ${to})`,
        periodLabel: `${from} to ${to}`,
        generatedAt: new Date().toISOString(),
        totalRecords: rows.length,
      },
      columns,
      rows,
      totals: {
        empId: 'Total Joinees',
        empName: `${rows.length} onboarded`,
      },
    };
  }

  // 8. Recent Resignee Report
  private async buildRecentResignees(filter: ReportFilterDto): Promise<ReportResult> {
    const today = new Date();
    const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
    const from = filter.from || ninetyDaysAgo.toISOString().split('T')[0];
    const to = filter.to || today.toISOString().split('T')[0];

    const employees = await this.repository.findRecentResignees(from, to, filter.department);

    const columns: ReportColumn[] = [
      { key: 'empId', label: 'Emp ID', width: '120px' },
      { key: 'empName', label: 'Emp Name', width: '180px' },
      { key: 'doj', label: 'Date of Joining', width: '120px' },
      { key: 'gender', label: 'Gender', width: '90px' },
      { key: 'lwd', label: 'Last Working Day (LWD)', width: '160px' },
      { key: 'status', label: 'Status', width: '120px' },
      { key: 'managerId', label: 'Manager ID', width: '120px' },
      { key: 'managerName', label: 'Manager Name', width: '160px' },
      { key: 'phone', label: 'Phone Number', width: '130px' },
      { key: 'employmentStatus', label: 'Employment Status', width: '140px' },
      { key: 'yrsInService', label: 'Yrs in Service', width: '130px' },
      { key: 'pan', label: 'PAN Number', width: '120px' },
      { key: 'uan', label: 'UAN Number', width: '130px' },
      { key: 'dob', label: 'Date of Birth', width: '120px' },
    ];

    const rows = employees.map((e) => {
      const exitDate = e.last_working_day || e.date_of_leaving || e.resignation_date || today.toISOString().split('T')[0];
      const tenure = calculateTenure(e.date_of_joining, exitDate);

      let status = 'Exited';
      if (e.is_notice_serving) status = 'Notice Serving';
      else if (e.resignation_date && (!e.last_working_day || e.last_working_day > today.toISOString().split('T')[0])) {
        status = 'Resigned';
      }

      return {
        empId: e.employee_code,
        empName: e.full_name,
        doj: e.date_of_joining,
        gender: e.gender || '—',
        lwd: exitDate,
        status,
        managerId: e.manager_code || (e.manager_id ? `BAM-${String(e.manager_id).padStart(4, '0')}` : '—'),
        managerName: e.manager_name || '—',
        phone: e.phone || '—',
        employmentStatus: e.employment_type || 'Full-time',
        yrsInService: tenure,
        pan: e.pan || '—',
        uan: e.uan || '—',
        dob: e.date_of_birth || '—',
      };
    });

    return {
      type: 'recent_resignees',
      meta: {
        companyName: COMPANY_HEADER.name,
        companyAddress: COMPANY_HEADER.address,
        reportTitle: `Recent Resignee Report (${from} to ${to})`,
        periodLabel: `${from} to ${to}`,
        generatedAt: new Date().toISOString(),
        totalRecords: rows.length,
      },
      columns,
      rows,
      totals: {
        empId: 'Total Resignees',
        empName: `${rows.length} records`,
      },
    };
  }

  // 9. Appraisal Report
  private async buildAppraisals(_filter: ReportFilterDto): Promise<ReportResult> {
    const revisions = await this.repository.findCompensationHistory();

    // Group revisions by employeeId
    const byEmployee = new Map<number, typeof revisions>();
    for (const r of revisions) {
      const list = byEmployee.get(r.employee_id) || [];
      list.push(r);
      byEmployee.set(r.employee_id, list);
    }

    const columns: ReportColumn[] = [
      { key: 'name', label: 'Name', width: '220px' },
      { key: 'employeeNo', label: 'Employee No', width: '130px' },
      { key: 'doj', label: 'DOJ', width: '120px' },
      { key: 'annualCtc', label: 'Annual CTC', isNumeric: true, isCurrency: true },
      { key: 'monthlySalary', label: 'Monthly Salary', isNumeric: true, isCurrency: true },
      { key: 'appraisalDate', label: 'Appraisal Date', width: '130px' },
      { key: 'incrementAmount', label: 'Increment Amount', isNumeric: true, isCurrency: true },
      { key: 'hikePercent', label: 'Percentage of Hike/Increment', width: '180px', isNumeric: true },
    ];

    let totalCtc = 0;
    let totalMonthly = 0;
    let totalIncrement = 0;
    let sumHikePct = 0;
    let countHikes = 0;

    const rows: Record<string, any>[] = [];

    for (const [, list] of byEmployee.entries()) {
      if (list.length === 0) continue;
      const latest = list[0];
      const currentCtc = Number(latest.ctc);
      const monthlySalary = Math.round(currentCtc / 12);
      totalCtc += currentCtc;
      totalMonthly += monthlySalary;

      let incrementAmount = 0;
      let hikePercent = 0;

      if (list.length > 1) {
        const previous = list[1];
        const prevCtc = Number(previous.ctc);
        if (currentCtc > prevCtc && prevCtc > 0) {
          incrementAmount = currentCtc - prevCtc;
          hikePercent = Math.round(((currentCtc - prevCtc) / prevCtc) * 1000) / 10;
        }
      }

      totalIncrement += incrementAmount;
      if (hikePercent > 0) {
        sumHikePct += hikePercent;
        countHikes++;
      }

      rows.push({
        name: latest.employee_name,
        employeeNo: latest.employee_code.replace('BAM-', ''),
        doj: latest.date_of_joining,
        annualCtc: currentCtc,
        monthlySalary,
        appraisalDate: latest.effective_from,
        incrementAmount,
        hikePercent: `${hikePercent.toFixed(1)}%`,
      });
    }

    const avgHike = countHikes > 0 ? (sumHikePct / countHikes).toFixed(1) : '0.0';

    return {
      type: 'appraisals',
      meta: {
        companyName: COMPANY_HEADER.name,
        companyAddress: COMPANY_HEADER.address,
        reportTitle: 'Employee Appraisal & Increment Report',
        periodLabel: 'FY 2026–27',
        generatedAt: new Date().toISOString(),
        totalRecords: rows.length,
      },
      columns,
      rows,
      totals: {
        name: 'Total / Average',
        annualCtc: totalCtc,
        monthlySalary: totalMonthly,
        incrementAmount: totalIncrement,
        hikePercent: `Avg ${avgHike}%`,
      },
    };
  }

  // CSV Export Engine
  async exportReportCsv(filter: ReportFilterDto, actorId: number): Promise<{ filename: string; csv: string }> {
    const report = await this.generateReport(filter, actorId);

    const lines: string[] = [];

    // Header metadata block matching company letterhead format
    lines.push(`"${report.meta.companyName}"`);
    lines.push(`"${report.meta.companyAddress}"`);
    lines.push(`"${report.meta.reportTitle}"`);
    if (report.meta.reportSubtitle) {
      lines.push(`"${report.meta.reportSubtitle}"`);
    }
    lines.push(''); // blank line

    // Column titles
    const colLabels = report.columns.map((c) => `"${c.label.replace(/"/g, '""')}"`);
    lines.push(colLabels.join(','));

    // Data rows
    for (const row of report.rows) {
      const cells = report.columns.map((col) => {
        let val = row[col.key];
        if (val === undefined || val === null) val = '';

        // SPECIAL REQUIREMENT: Preserve leading zeros in bank accounts
        if (col.key === 'beneficiaryAccountNo' || col.key === 'account_no') {
          return `="${String(val)}"`;
        }

        if (typeof val === 'number') {
          return String(val);
        }

        return `"${String(val).replace(/"/g, '""')}"`;
      });
      lines.push(cells.join(','));
    }

    // Totals footer row
    if (report.totals) {
      const totalCells = report.columns.map((col) => {
        const val = report.totals![col.key];
        if (val === undefined || val === null) return '""';
        return `"${String(val).replace(/"/g, '""')}"`;
      });
      lines.push(totalCells.join(','));
    }

    // Prefix with UTF-8 BOM for clean Excel rendering
    const csvContent = '﻿' + lines.join('\r\n');
    const filename = `${report.type}_report_${new Date().toISOString().split('T')[0]}.csv`;

    return { filename, csv: csvContent };
  }
}
