import { IClock } from '../../shared/clock';
import { compensationOn } from './compensation.domain';
import { ICompensationRepository } from './compensation.repository.interface';
import { ICompensationService } from './compensation.service.interface';
import { CompensationRecord } from './compensation.model';

/**
 * What someone is paid.
 *
 * Deliberately thin: it reads the history and applies one rule. The rule lives
 * in the domain so it can be tested without a database, and so the Salary page
 * resolves "current pay" exactly the same way rather than writing its own
 * ORDER BY and drifting.
 */
export class CompensationService implements ICompensationService {
  constructor(
    private readonly compensationRepository: ICompensationRepository,
    private readonly clock: IClock,
  ) {}

  async getCurrent(employeeId: number): Promise<CompensationRecord | null> {
    const history = await this.compensationRepository.findHistory(employeeId);
    // The database's day. A revision dated tomorrow must not surface today, and
    // this process's clock is not the one the dates were written against.
    return compensationOn(history, await this.clock.today());
  }
}
