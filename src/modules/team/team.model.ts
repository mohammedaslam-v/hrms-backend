import { RosterMember } from '../org/org.model';

/** A row of the directory. Pay is present only for a viewer entitled to it. */
export interface DirectoryMember extends RosterMember {
  /**
   * Annual CTC, or null when nothing is on record.
   *
   * Absent entirely — not null — for a viewer who may not see pay, so the two
   * cases stay distinguishable and the figures never leave the server for
   * someone who should not have them.
   */
  ctc?: number | null;
}

export interface DirectoryView {
  /**
   * Whether the pay column should be drawn at all.
   *
   * Sent explicitly rather than inferred from whether `ctc` happens to be
   * present: today no salary is loaded, so every row would look identical to a
   * withheld one, and the table would silently drop the column for admins.
   */
  canSeePay: boolean;
  /** Why this person can see this list — drives the page's subtitle. */
  scope: 'company' | 'team';
  members: DirectoryMember[];
}
