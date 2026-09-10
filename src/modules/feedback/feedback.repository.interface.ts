import { AddFeedbackInput, FeedbackRecord } from './feedback.model';

export interface IFeedbackRepository {
  /**
   * Every note about this employee, newest first — INCLUDING restricted ones.
   *
   * Filtering is the service's job, not this one's. A repository that silently
   * dropped rows would make the visibility rule invisible at the point it
   * matters, and impossible to test on its own.
   */
  findForEmployee(employeeId: number): Promise<FeedbackRecord[]>;

  /** Records a note and returns it as stored, author's name resolved. */
  add(input: AddFeedbackInput): Promise<FeedbackRecord>;
}
