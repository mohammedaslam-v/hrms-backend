import { ProfileAccess } from '../access/access.domain';
import { FeedbackRecord, FeedbackVisibility } from './feedback.model';

export interface IFeedbackService {
  /**
   * Notes this viewer is allowed to read about `employeeId`.
   *
   * `access` is passed in rather than resolved here because the caller has
   * already established it — and because the answer differs for the SUBJECT of
   * the notes, which is the unusual part of this rule.
   */
  getVisibleTo(employeeId: number, access: ProfileAccess): Promise<FeedbackRecord[]>;

  /**
   * Write a note about someone. Refuses unless the author manages them or holds
   * admin — and refuses for your own record, whoever you are.
   */
  add(
    authorId: number,
    employeeId: number,
    input: { body: string; visibility: FeedbackVisibility },
  ): Promise<FeedbackRecord[]>;
}
