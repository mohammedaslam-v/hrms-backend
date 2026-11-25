import { RequestHandler } from 'express';
import { ICompensationService } from '../compensation/compensation.service.interface';
import { countablePay, lastDayOfMonth } from '../compensation/compensation.domain';
import { payStructure } from '../salary/salary.domain';
import { IClock } from '../../shared/clock';
import { InternalCompensationRepository } from './internal-compensation.repository';
import { ApiError } from '../../utils/api-error';
import { asyncHandler } from '../../utils/async-handler';

const MAX_IDS = 500;

/**
 * Salary cost for the admin panel's Sales Pulse page, keyed by admins.id.
 *
 * Salaries are encrypted and only HRMS holds the key, so admin-backend asks
 * here instead of reading the table. It returns two figures per person — annual
 * CTC and monthly gross — and nothing else: no breakup, no bonus, no bank or
 * PAN. admin-backend turns them into sales ÷ cost and never sends a salary to
 * the browser.
 */
export class InternalCompensationController {
  constructor(
    private readonly compensationService: ICompensationService,
    private readonly repository: InternalCompensationRepository,
    private readonly clock: IClock,
  ) {}

  getByAdmins: RequestHandler = asyncHandler(async (req, res) => {
    const raw = String(req.query.adminIds ?? '').trim();
    const parts = raw === '' ? [] : raw.split(',').map((p) => p.trim());
    if (parts.length === 0 || parts.some((p) => !/^\d+$/.test(p))) {
      throw ApiError.badRequest('adminIds must be a comma-separated list of whole numbers.');
    }
    const adminIds = [...new Set(parts.map(Number))];
    if (adminIds.length > MAX_IDS) {
      throw ApiError.badRequest(`At most ${MAX_IDS} adminIds per call.`);
    }

    // The database's month, not this process's — the two can sit in different timezones.
    const month = req.query.month ? String(req.query.month) : (await this.clock.today()).slice(0, 7);
    const onDate = lastDayOfMonth(month);
    if (!onDate) {
      throw ApiError.badRequest('month must look like 2026-10.');
    }

    const people = await this.repository.findEmployeesByAdminIds(adminIds);
    const pay = await this.compensationService.getOnDateForMany(
      people.map((p) => p.employeeId),
      onDate,
    );

    const employees = people.map((p) => {
      const record = countablePay(pay.get(p.employeeId));
      return {
        adminId: p.adminId,
        employeeCode: p.employeeCode,
        name: p.fullName,
        ctc: record ? record.ctc : null,
        monthlyGross: record ? Math.round(payStructure(record.ctc, record.components).grossM) : null,
        isSet: record !== null,
      };
    });

    // Who asked for how much, never the amounts.
    console.info(
      `[internal/compensation] month=${month} requested=${adminIds.length} matched=${people.length} set=${employees.filter((e) => e.isSet).length}`,
    );

    res.json({ success: true, data: { month, employees } });
  });
}
