import { IPolicyRepository } from './policy.repository.interface';
import { IPolicyService } from './policy.service.interface';
import { FinancialYearConfig } from './policy.model';
import { ApiError } from '../../utils/api-error';

/**
 * Reads company policy for a date. Deliberately does not cache: HR changing the
 * grace window should take effect on the next request, not on the next deploy,
 * and this is one indexed row on the primary key.
 */
export class PolicyService implements IPolicyService {
  constructor(private readonly policyRepository: IPolicyRepository) {}

  async getForDate(date: string): Promise<FinancialYearConfig> {
    const config = await this.policyRepository.findFinancialYearForDate(date);
    if (!config) {
      // 503, not 404: the request was fine, the system is not set up. The
      // message names the missing row so whoever reads the log can fix it.
      throw new ApiError(
        503,
        `Company policy is not configured for ${date}. Add the financial year to hrms_fy_config.`,
      );
    }
    return config;
  }

  getCurrent(): Promise<FinancialYearConfig> {
    return this.getForDate(new Date().toISOString().slice(0, 10));
  }
}
