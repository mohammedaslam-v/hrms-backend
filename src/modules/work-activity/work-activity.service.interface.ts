import { WorkActivity, WorkActivityRange } from './work-activity.model';

export interface IWorkActivityService {
  /**
   * `subjectId`'s activities between two dates — for anyone who may open their
   * My Page (self, their manager, an admin).
   */
  listFor(viewerId: number, subjectId: number, from: string, to: string): Promise<WorkActivityRange>;

  /** Records an activity on the viewer's own day. Nobody records for someone else. */
  create(viewerId: number, raw: Record<string, unknown>): Promise<WorkActivity>;

  /** Deletes one of the viewer's own activities, while its day is still editable. */
  remove(viewerId: number, activityId: number): Promise<void>;
}
