import { canRecordAbout, canSeeRestrictedFeedback, ProfileAccess } from '../access/access.domain';
import { IAccessService } from '../access/access.service.interface';
import { recordAudit } from '../../shared/audit';
import { ApiError } from '../../utils/api-error';
import { FeedbackVisibility } from './feedback.model';
import type { Pool } from 'mysql2/promise';
import type { IClock } from '../../shared/clock';
import { FeedbackRecord } from './feedback.model';
import { IFeedbackRepository } from './feedback.repository.interface';
import { IFeedbackService } from './feedback.service.interface';

/**
 * Feedback from a manager.
 *
 * The one rule here is unusual and worth reading twice: being the SUBJECT of a
 * note gives you less access, not more. A note marked `managers_only` is written
 * about somebody, not for them, and they never see it — however senior they are.
 * An admin reading their own page does not see notes written about them.
 *
 * The filter runs here, in the service, so a restricted note never reaches the
 * response at all. Hiding it in the browser would put the text one devtools
 * panel away from the person it was written about.
 */
export class FeedbackService implements IFeedbackService {
  constructor(
    private readonly feedbackRepository: IFeedbackRepository,
    private readonly accessService: IAccessService,
    private readonly clock: IClock,
    private readonly pool: Pool,
  ) {}

  async getVisibleTo(employeeId: number, access: ProfileAccess): Promise<FeedbackRecord[]> {
    const all = await this.feedbackRepository.findForEmployee(employeeId);

    // Notes written for the employee are open to anyone who can open the page.
    if (canSeeRestrictedFeedback(access)) return all;
    return all.filter((note) => note.visibility === 'employee');
  }

  async add(
    authorId: number,
    employeeId: number,
    input: { body: string; visibility: FeedbackVisibility },
  ): Promise<FeedbackRecord[]> {
    const access = await this.accessService.require(authorId, employeeId);
    if (!canRecordAbout(access)) {
      throw new ApiError(
        403,
        'Only a manager or an admin can leave feedback, and not on their own record.',
      );
    }

    const body = input.body.trim();
    if (!body) throw ApiError.badRequest('Write something before saving.');

    const stored = await this.feedbackRepository.add({
      employeeId,
      authorId,
      body,
      visibility: input.visibility,
      // The database's day, so a note written near midnight is dated the way the
      // rows around it are.
      givenOn: await this.clock.today(),
    });

    // The body is deliberately NOT in the audit row. A restricted note must not
    // become readable through the audit log by someone who cannot read the note.
    await recordAudit(this.pool, {
      actorEmployeeId: authorId,
      action: 'feedback.added',
      entityType: 'hrms_employee_feedback',
      entityId: stored.id,
      before: null,
      after: { employeeId, visibility: stored.visibility, length: body.length },
    });

    return this.getVisibleTo(employeeId, access);
  }
}
