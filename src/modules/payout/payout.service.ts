import crypto from 'crypto';
import { IPayoutService } from './payout.service.interface';
import { IOtpService } from '../auth/otp.service.interface';
import { IAuthService } from '../auth/auth.service.interface';
import { IReimbursementRepository } from '../reimbursement/reimbursement.repository.interface';
import {
  RequestPayoutOtpResponseDto,
  PushLoanPayoutDto,
  PushReimbursementPayoutDto,
  PushReimbursementResponseDto,
} from './payout.model';
import { IPayoutRepository } from './payout.repository.interface';
import { ISalaryService } from '../salary/salary.service.interface';
import {
  PushSalaryPayoutDto,
  PushSalaryResponseDto,
  PushSalaryResultItem,
  PushLoanResponseDto,
  CsvReconciliationResult,
  PayoutRecord,
  PayoutMode,
  PayoutStatus,
} from './payout.model';
import { env } from '../../config/env';
import { ApiError } from '../../utils/api-error';

/**
 * A narration Razorpay will accept: letters, digits and spaces only, 30 max.
 *
 * Anything else is rejected outright with "The narration format is invalid",
 * and the payout never reaches the bank. Employee codes carry a hyphen —
 * `BAM-014` — so every loan narration hit this until the strip was added.
 * Collapsing whitespace matters too: a stripped character can leave a double
 * space behind, which reads as a typo on the recipient's statement.
 */
const narrationOf = (text: string): string =>
  text
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 30);

export class PayoutService implements IPayoutService {
  constructor(
    private readonly payoutRepository: IPayoutRepository,
    private readonly salaryService: ISalaryService,
    private readonly otpService?: IOtpService,
    private readonly authService?: IAuthService,
    private readonly reimbursementRepository?: IReimbursementRepository,
  ) {}

  private isMockMode(): boolean {
    return (
      env.razorpay.mode === 'mock' ||
      !env.razorpay.key ||
      !env.razorpay.secret
    );
  }

  private getAuthHeader(): string {
    return (
      'Basic ' +
      Buffer.from(`${env.razorpay.key}:${env.razorpay.secret}`).toString('base64')
    );
  }

  async ensureEmployeeFundAccount(
    employeeId: number,
  ): Promise<{ contactId: string; fundAccountId: string }> {
    const meta = await this.payoutRepository.findEmployeeBankMeta(employeeId);
    if (!meta) {
      throw ApiError.notFound(`Employee ${employeeId} not found`);
    }

    if (!meta.accountNo || !meta.ifscCode) {
      throw ApiError.badRequest(
        `Employee ${meta.fullName} (${meta.employeeCode}) has missing bank account number or IFSC code.`
      );
    }

    let contactId = meta.razorpayContactId;
    let fundAccountId = meta.razorpayFundAccountId;

    // 1. Create or retrieve Contact
    if (!contactId) {
      if (this.isMockMode()) {
        contactId = `cont_mock_${meta.employeeCode.toLowerCase()}_${Date.now()}`;
      } else {
        const res = await fetch('https://api.razorpay.com/v1/contacts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: this.getAuthHeader(),
          },
          body: JSON.stringify({
            name: meta.fullName,
            email: meta.workEmail,
            contact: meta.phone || '9999999999',
            type: 'employee',
            reference_id: `Bambinos HRMS ${meta.employeeCode}`,
            notes: { employee_id: String(employeeId) },
          }),
        });
        const data: any = await res.json();
        if (!res.ok || !data.id) {
          throw new Error(
            data?.error?.description || 'Failed to create Razorpay contact'
          );
        }
        contactId = data.id;
      }
      await this.payoutRepository.updateEmployeeRazorpayIds(
        employeeId,
        contactId,
        null
      );
    }

    // 2. Create Fund Account
    if (!fundAccountId) {
      if (this.isMockMode()) {
        fundAccountId = `fa_mock_${meta.employeeCode.toLowerCase()}_${Date.now()}`;
      } else {
        const res = await fetch('https://api.razorpay.com/v1/fund_accounts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: this.getAuthHeader(),
          },
          body: JSON.stringify({
            contact_id: contactId,
            account_type: 'bank_account',
            bank_account: {
              name: meta.fullName,
              ifsc: meta.ifscCode.toUpperCase().trim(),
              account_number: meta.accountNo.trim(),
            },
          }),
        });
        const data: any = await res.json();
        if (!res.ok || !data.id) {
          throw new Error(
            data?.error?.description || 'Failed to create Razorpay fund account'
          );
        }
        fundAccountId = data.id;
      }
      await this.payoutRepository.updateEmployeeRazorpayIds(
        employeeId,
        contactId,
        fundAccountId
      );
    }

    return { contactId: contactId!, fundAccountId: fundAccountId! };
  }

  async pushSingleSalaryPayout(
    employeeId: number,
    month: string,
    adminId: number,
    mode: PayoutMode = 'NEFT',
  ): Promise<PushSalaryResultItem> {
    const meta = await this.payoutRepository.findEmployeeBankMeta(employeeId);
    if (!meta) {
      throw ApiError.notFound(`Employee ${employeeId} not found`);
    }

    // Check for existing active payout for this month
    const existing = await this.payoutRepository.findActivePayout(
      'salary',
      month,
      employeeId
    );
    if (existing) {
      return {
        employeeId,
        employeeCode: meta.employeeCode,
        fullName: meta.fullName,
        amount: existing.amount,
        payoutId: existing.id,
        razorpayPayoutId: existing.razorpayPayoutId,
        status: existing.status,
      };
    }

    // 1. Calculate net salary. `month` arrives as YYYY-MM-01 (it is also the
    // payout's reference_id); the salary engine takes YYYY-MM and falls back to
    // the CURRENT month for anything else — which would pay the wrong slip.
    const salaryView = await this.salaryService.getMySalary(
      adminId,
      employeeId,
      month.slice(0, 7)
    );
    if (!salaryView.slip) {
      throw ApiError.badRequest(
        `Could not generate salary slip for ${meta.fullName} for ${month}`
      );
    }
    const netPay = salaryView.slip.netPay;
    if (netPay <= 0) {
      throw ApiError.badRequest(
        `Net pay for ${meta.fullName} is ₹${netPay}. Payout skipped.`
      );
    }

    // 2. Ensure Contact & Fund Account
    const { contactId, fundAccountId } =
      await this.ensureEmployeeFundAccount(employeeId);

    // 3. Create Payout entry in DB with 'queued'
    const idempotencyKey = crypto.randomUUID();
    const amountPaise = Math.round(netPay * 100);
    const monthShort = new Date(month).toLocaleString('en-US', {
      month: 'short',
      year: 'numeric',
    });
    const narration = narrationOf(`Bambinos Salary ${monthShort}`);

    const record = await this.payoutRepository.createPayout({
      payoutType: 'salary',
      referenceId: month,
      employeeId,
      adminId,
      amount: netPay,
      amountPaise,
      razorpayPayoutId: null,
      razorpayContactId: contactId,
      razorpayFundAccountId: fundAccountId,
      status: 'processing',
      mode,
      purpose: 'salary',
      narration,
      utr: null,
      failureReason: null,
      failureDescription: null,
      failureSource: null,
      idempotencyKey,
    });

    // Saved before any money moves: the next month's arrears or recovery is
    // measured against exactly what this slip deducted and paid back.
    await this.payoutRepository.saveSalarySnapshot(record.id, {
      lopDays: salaryView.slip.lopDays,
      lopRate: salaryView.slip.lopRate,
      arrearsAmount: salaryView.slip.earnings.arrears,
    });

    // 4. Send to Razorpay
    let razorpayPayoutId: string;
    let finalStatus: PayoutStatus = 'processing';
    let failureReason: string | null = null;
    let failureDesc: string | null = null;

    if (this.isMockMode()) {
      razorpayPayoutId = `pout_mock_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    } else {
      try {
        const res = await fetch('https://api.razorpay.com/v1/payouts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Payout-Idempotency': idempotencyKey,
            Authorization: this.getAuthHeader(),
          },
          body: JSON.stringify({
            account_number: env.razorpay.account,
            fund_account_id: fundAccountId,
            amount: amountPaise,
            currency: 'INR',
            mode,
            purpose: 'salary',
            queue_if_low_balance: true,
            narration,
          }),
        });

        const data: any = await res.json();
        if (!res.ok) {
          finalStatus = 'failed';
          failureReason = data?.error?.code || 'PAYOUT_FAILED';
          failureDesc = data?.error?.description || 'Razorpay payout request failed';
          razorpayPayoutId = data?.id || `err_${Date.now()}`;
        } else {
          razorpayPayoutId = data.id;
          finalStatus = data.status || 'processing';
        }
      } catch (err: any) {
        finalStatus = 'failed';
        failureReason = 'NETWORK_ERROR';
        failureDesc = err.message || 'Error connecting to Razorpay';
        razorpayPayoutId = `err_${Date.now()}`;
      }
    }

    await this.payoutRepository.updatePayoutRazorpayInfo(
      record.id,
      razorpayPayoutId,
      finalStatus,
      failureReason,
      failureDesc
    );

    return {
      employeeId,
      employeeCode: meta.employeeCode,
      fullName: meta.fullName,
      amount: netPay,
      payoutId: record.id,
      razorpayPayoutId,
      status: finalStatus,
      error: failureDesc || undefined,
    };
  }

  async pushSalaryPayouts(
    dto: PushSalaryPayoutDto,
    adminId: number,
  ): Promise<PushSalaryResponseDto> {
    const items: PushSalaryResultItem[] = [];
    let totalSuccess = 0;
    let totalFailed = 0;
    let totalAmount = 0;

    for (const employeeId of dto.employeeIds) {
      try {
        const res = await this.pushSingleSalaryPayout(
          employeeId,
          dto.month,
          adminId,
          dto.mode || 'NEFT'
        );
        items.push(res);
        if (res.status === 'failed' || res.status === 'rejected') {
          totalFailed++;
        } else {
          totalSuccess++;
          totalAmount += res.amount;
        }
      } catch (err: any) {
        totalFailed++;
        items.push({
          employeeId,
          employeeCode: `ID-${employeeId}`,
          fullName: 'Employee',
          amount: 0,
          status: 'failed',
          error: err.message || 'Failed to process payout',
        });
      }
    }

    return {
      month: dto.month,
      totalRequested: dto.employeeIds.length,
      totalSuccess,
      totalFailed,
      totalAmount,
      items,
    };
  }

  async requestPayoutOtp(
    adminId: number,
    ipAddress: string | null,
  ): Promise<RequestPayoutOtpResponseDto> {
    if (this.authService) {
      const viewer = await this.authService.getCurrentEmployee(adminId);
      if (!viewer.tiers.includes('admin')) {
        throw ApiError.forbidden('Only administrators can authorize payouts.');
      }
    }

    const meta = await this.payoutRepository.findEmployeeBankMeta(adminId);
    const email = meta?.workEmail;
    if (!email) {
      throw ApiError.badRequest('No admin work email found to send authorization code.');
    }

    if (!this.otpService) {
      throw new Error('OTP service is not configured.');
    }

    const challenge = await this.otpService.issue(
      adminId,
      email,
      'step_up',
      ipAddress,
    );

    return {
      challengeId: challenge.challengeId,
      sentTo: challenge.sentTo,
    };
  }

  async pushLoanDisbursement(
    dto: PushLoanPayoutDto,
    adminId: number,
  ): Promise<PushLoanResponseDto> {
    const { loanId, challengeId, otp, mode = 'NEFT' } = dto;

    if (!challengeId || !otp) {
      throw ApiError.badRequest('Admin authorization OTP is required to disburse loan funds.');
    }

    if (this.otpService) {
      await this.otpService.verify(challengeId, otp, 'step_up');
    }

    const loan = await this.payoutRepository.findLoanById(loanId);
    if (!loan) {
      throw ApiError.notFound(`Loan ${loanId} not found`);
    }

    if (loan.status === 'active') {
      throw ApiError.badRequest('Loan is already disbursed and active.');
    }

    const meta = await this.payoutRepository.findEmployeeBankMeta(loan.employeeId);
    if (!meta) {
      throw ApiError.notFound(`Employee for loan ${loanId} not found`);
    }

    if (meta.employeeCode.startsWith('TEST') || (meta.workEmail && meta.workEmail.toLowerCase().includes('test'))) {
      throw ApiError.badRequest('Bank disbursements are permanently disabled for test accounts.');
    }

    // 1. Ensure Contact & Fund Account
    const { contactId, fundAccountId } =
      await this.ensureEmployeeFundAccount(loan.employeeId);

    // 2. Create Payout entry
    const idempotencyKey = crypto.randomUUID();
    const amountPaise = Math.round(loan.amount * 100);
    const narration = narrationOf(`Bambinos Loan ${meta.employeeCode}`);

    const record = await this.payoutRepository.createPayout({
      payoutType: 'loan',
      referenceId: String(loanId),
      employeeId: loan.employeeId,
      adminId,
      amount: loan.amount,
      amountPaise,
      razorpayPayoutId: null,
      razorpayContactId: contactId,
      razorpayFundAccountId: fundAccountId,
      status: 'processing',
      mode,
      purpose: 'salary',
      narration,
      utr: null,
      failureReason: null,
      failureDescription: null,
      failureSource: null,
      idempotencyKey,
    });

    // 3. Send to Razorpay
    let razorpayPayoutId: string;
    let finalStatus: PayoutStatus = 'processing';
    let failureReason: string | null = null;
    let failureDesc: string | null = null;

    if (this.isMockMode()) {
      razorpayPayoutId = `pout_loan_mock_${Date.now()}`;
    } else {
      try {
        const res = await fetch('https://api.razorpay.com/v1/payouts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Payout-Idempotency': idempotencyKey,
            Authorization: this.getAuthHeader(),
          },
          body: JSON.stringify({
            account_number: env.razorpay.account,
            fund_account_id: fundAccountId,
            amount: amountPaise,
            currency: 'INR',
            mode,
            purpose: 'salary',
            queue_if_low_balance: true,
            narration,
          }),
        });

        const data: any = await res.json();
        if (!res.ok) {
          finalStatus = 'failed';
          failureReason = data?.error?.code || 'PAYOUT_FAILED';
          failureDesc = data?.error?.description || 'Razorpay loan payout failed';
          razorpayPayoutId = data?.id || `err_${Date.now()}`;
        } else {
          razorpayPayoutId = data.id;
          finalStatus = data.status || 'processing';
        }
      } catch (err: any) {
        finalStatus = 'failed';
        failureReason = 'NETWORK_ERROR';
        failureDesc = err.message || 'Error connecting to Razorpay';
        razorpayPayoutId = `err_${Date.now()}`;
      }
    }

    await this.payoutRepository.updatePayoutRazorpayInfo(
      record.id,
      razorpayPayoutId,
      finalStatus,
      failureReason,
      failureDesc
    );

    const loanNewStatus =
      finalStatus === 'failed' || finalStatus === 'rejected'
        ? 'disbursement_failed'
        : 'pending_disbursement';
    await this.payoutRepository.updateLoanDisbursement(
      loanId,
      record.id,
      loanNewStatus
    );

    return {
      loanId,
      employeeId: loan.employeeId,
      amount: loan.amount,
      payoutId: record.id,
      razorpayPayoutId,
      status: finalStatus,
      utr: null,
    };
  }

  async pushReimbursementDisbursement(
    dto: PushReimbursementPayoutDto,
    adminId: number,
  ): Promise<PushReimbursementResponseDto> {
    const { claimId, challengeId, otp, mode = 'NEFT' } = dto;

    if (!challengeId || !otp) {
      throw ApiError.badRequest('Admin authorization OTP is required to disburse reimbursement funds.');
    }

    if (this.otpService) {
      await this.otpService.verify(challengeId, otp, 'step_up');
    }

    if (!this.reimbursementRepository) {
      throw new Error('Reimbursement repository not wired.');
    }

    const claim = await this.reimbursementRepository.findById(claimId);
    if (!claim) {
      throw ApiError.notFound(`Reimbursement claim ${claimId} not found`);
    }

    if (claim.status === 'Paid') {
      throw ApiError.badRequest('This reimbursement claim has already been paid.');
    }

    if (claim.status === 'Rejected' || claim.status === 'Cancelled') {
      throw ApiError.badRequest(`Cannot disburse a claim with status: ${claim.status}`);
    }

    const payoutAmount = Number(dto.approvedAmount ?? claim.approvedAmount ?? claim.claimAmount);
    if (isNaN(payoutAmount) || payoutAmount <= 0) {
      throw ApiError.badRequest('A valid payout amount greater than ₹0 is required.');
    }

    // If claim was still Pending, mark it Approved
    if (claim.status === 'Pending') {
      await this.reimbursementRepository.updateDecision(claimId, {
        status: 'Approved',
        approvedAmount: payoutAmount,
        rejectionReason: null,
        adminNotes: 'Approved with RazorpayX disbursement authorization',
        decidedBy: adminId,
      });
    }

    const meta = await this.payoutRepository.findEmployeeBankMeta(claim.employeeId);
    if (!meta) {
      throw ApiError.notFound(`Employee bank details not found for employee ${claim.employeeId}`);
    }

    if (meta.employeeCode.startsWith('TEST') || (meta.workEmail && meta.workEmail.toLowerCase().includes('test'))) {
      throw ApiError.badRequest('Bank disbursements are permanently disabled for test accounts.');
    }

    // 1. Ensure Contact & Fund Account
    const { contactId, fundAccountId } =
      await this.ensureEmployeeFundAccount(claim.employeeId);

    // 2. Create Payout entry
    const idempotencyKey = crypto.randomUUID();
    const amountPaise = Math.round(payoutAmount * 100);
    const narration = narrationOf(`Bambinos Exp ${claim.ref}`);

    const record = await this.payoutRepository.createPayout({
      payoutType: 'reimbursement',
      referenceId: String(claimId),
      employeeId: claim.employeeId,
      adminId,
      amount: payoutAmount,
      amountPaise,
      razorpayPayoutId: null,
      razorpayContactId: contactId,
      razorpayFundAccountId: fundAccountId,
      status: 'processing',
      mode,
      purpose: 'salary',
      narration,
      utr: null,
      failureReason: null,
      failureDescription: null,
      failureSource: null,
      idempotencyKey,
    });

    // 3. Send to Razorpay
    let razorpayPayoutId: string;
    let finalStatus: PayoutStatus = 'processing';
    let failureReason: string | null = null;
    let failureDesc: string | null = null;

    if (this.isMockMode()) {
      razorpayPayoutId = `pout_reimb_mock_${Date.now()}`;
    } else {
      try {
        const res = await fetch('https://api.razorpay.com/v1/payouts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Payout-Idempotency': idempotencyKey,
            Authorization: this.getAuthHeader(),
          },
          body: JSON.stringify({
            account_number: env.razorpay.account,
            fund_account_id: fundAccountId,
            amount: amountPaise,
            currency: 'INR',
            mode,
            purpose: 'salary',
            queue_if_low_balance: true,
            narration,
          }),
        });

        const data: any = await res.json();
        if (!res.ok) {
          finalStatus = 'failed';
          failureReason = data?.error?.code || 'PAYOUT_FAILED';
          failureDesc = data?.error?.description || 'Razorpay reimbursement payout failed';
          razorpayPayoutId = data?.id || `err_${Date.now()}`;
        } else {
          razorpayPayoutId = data.id;
          finalStatus = data.status || 'processing';
        }
      } catch (err: any) {
        finalStatus = 'failed';
        failureReason = 'NETWORK_ERROR';
        failureDesc = err.message || 'Error connecting to Razorpay';
        razorpayPayoutId = `err_${Date.now()}`;
      }
    }

    await this.payoutRepository.updatePayoutRazorpayInfo(
      record.id,
      razorpayPayoutId,
      finalStatus,
      failureReason,
      failureDesc
    );

    if (finalStatus !== 'failed' && finalStatus !== 'rejected') {
      const today = new Date().toISOString().slice(0, 10);
      await this.reimbursementRepository.markPaid(claimId, {
        paymentDate: today,
        paymentReference: `RazorpayX: ${razorpayPayoutId}`,
      });
    }

    return {
      claimId,
      employeeId: claim.employeeId,
      amount: payoutAmount,
      payoutId: record.id,
      razorpayPayoutId,
      status: finalStatus,
      utr: null,
    };
  }
  async processWebhook(
    _event: string,
    payload: any,
  ): Promise<{ handled: boolean; message: string }> {
    const entity = payload?.payout?.entity || payload?.entity || payload;
    const payoutId = entity?.id;
    const status = entity?.status;
    const utr = entity?.utr || null;
    const failureReason = entity?.status_details?.reason || null;
    const failureDesc = entity?.status_details?.description || null;

    if (!payoutId || !status) {
      return { handled: false, message: 'Missing payout id or status in payload' };
    }

    const updated = await this.payoutRepository.updatePayoutStatusByRazorpayId(
      payoutId,
      status,
      utr,
      failureReason,
      failureDesc
    );

    if (!updated) {
      return { handled: false, message: `Payout ${payoutId} not found in database` };
    }

    // If this payout was a loan disbursement, update the loan status
    if (updated.payoutType === 'loan') {
      const loanId = Number(updated.referenceId);
      if (loanId > 0) {
        if (status === 'processed') {
          await this.payoutRepository.updateLoanDisbursement(
            loanId,
            updated.id,
            'active'
          );
        } else if (status === 'failed' || status === 'reversed') {
          await this.payoutRepository.updateLoanDisbursement(
            loanId,
            updated.id,
            'disbursement_failed'
          );
        }
      }
    }

    return {
      handled: true,
      message: `Payout ${payoutId} updated to ${status}` + (utr ? ` (UTR: ${utr})` : ''),
    };
  }

  async reconcileFromCsv(csvContent: string): Promise<CsvReconciliationResult> {
    const lines = csvContent.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

    if (lines.length <= 1) {
      return {
        totalRows: 0,
        updatedCount: 0,
        notFoundCount: 0,
        skippedCount: 0,
        details: [],
      };
    }

    // Split headers
    const headerLine = lines[0];
    const delimiter = headerLine.includes('	') ? '	' : ',';
    const headers = headerLine.split(delimiter).map((h) => h.replace(/^["']|["']$/g, '').trim().toLowerCase());

    // Find key column indexes
    let idIdx = headers.findIndex((h) => h.includes('payout_id') || h === 'id' || h.includes('payout id'));
    let statusIdx = headers.findIndex((h) => h.includes('status'));
    let utrIdx = headers.findIndex((h) => h.includes('utr') || h.includes('bank_ref') || h.includes('reference'));

    // Fallbacks matching bambinos-admin (col 0: id, col 6: status, col 7: utr)
    if (idIdx === -1) idIdx = 0;
    if (statusIdx === -1 && headers.length > 6) statusIdx = 6;
    if (utrIdx === -1 && headers.length > 7) utrIdx = 7;

    const details: CsvReconciliationResult['details'] = [];
    let updatedCount = 0;
    let notFoundCount = 0;
    let skippedCount = 0;

    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(delimiter).map((col) => col.replace(/^["']|["']$/g, '').trim());
      const rawPayoutId = row[idIdx];
      const rawStatus = row[statusIdx]?.toLowerCase();
      const rawUtr = utrIdx >= 0 ? row[utrIdx] : undefined;

      if (!rawPayoutId || !rawStatus) {
        skippedCount++;
        continue;
      }

      const updated = await this.payoutRepository.updatePayoutStatusByRazorpayId(
        rawPayoutId,
        rawStatus as PayoutStatus,
        rawUtr || null
      );

      if (updated) {
        updatedCount++;
        details.push({
          payoutId: rawPayoutId,
          newStatus: rawStatus,
          utr: rawUtr,
          updated: true,
        });

        // Also update loan if applicable
        if (updated.payoutType === 'loan') {
          const loanId = Number(updated.referenceId);
          if (loanId > 0) {
            if (rawStatus === 'processed') {
              await this.payoutRepository.updateLoanDisbursement(loanId, updated.id, 'active');
            } else if (rawStatus === 'failed' || rawStatus === 'reversed') {
              await this.payoutRepository.updateLoanDisbursement(loanId, updated.id, 'disbursement_failed');
            }
          }
        }
      } else {
        notFoundCount++;
        details.push({
          payoutId: rawPayoutId,
          newStatus: rawStatus,
          utr: rawUtr,
          updated: false,
        });
      }
    }

    return {
      totalRows: lines.length - 1,
      updatedCount,
      notFoundCount,
      skippedCount,
      details,
    };
  }

  async getPayoutsForMonth(month: string): Promise<PayoutRecord[]> {
    return this.payoutRepository.listPayoutsForMonth(month);
  }

  async updateEmployeeBankDetails(
    employeeId: number,
    bankName: string,
    accountNo: string,
    ifscCode: string,
  ): Promise<void> {
    await this.payoutRepository.updateEmployeeBankDetails(
      employeeId,
      bankName.trim(),
      accountNo.trim(),
      ifscCode.toUpperCase().trim()
    );
    // Reset fund account id so a fresh one is created with the new bank info
    await this.payoutRepository.updateEmployeeRazorpayIds(
      employeeId,
      null,
      null
    );
  }
}
