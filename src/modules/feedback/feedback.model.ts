/**
 * Who a note may be shown to.
 *
 * `employee` — written FOR the person; anyone who can open the profile sees it.
 * `managers_only` — written ABOUT the person; the subject never sees it.
 *
 * The column defaults to `employee`, so withholding a note is always a
 * deliberate act rather than something that happens by forgetting a field.
 */
export type FeedbackVisibility = 'employee' | 'managers_only';

export interface FeedbackRecord {
  id: number;
  employeeId: number;
  authorId: number;
  authorName: string | null;
  body: string;
  visibility: FeedbackVisibility;
  givenOn: string;
}

/** What a manager supplies when writing a note. */
export interface AddFeedbackInput {
  employeeId: number;
  authorId: number;
  body: string;
  visibility: FeedbackVisibility;
  givenOn: string;
}
