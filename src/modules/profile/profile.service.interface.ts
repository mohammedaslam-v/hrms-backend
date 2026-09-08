import { ProfileView } from './profile.model';

export interface IProfileService {
  /**
   * Build My page for `subjectId`, as seen by `viewerId`.
   *
   * The two ids are separate because the same screen serves both cases: your own
   * profile, and a report's profile opened from the team directory. What the
   * viewer is allowed to see is decided here, not by the caller — so the fields
   * they may not see are never in the response to begin with.
   *
   * Throws 403 when the viewer has no claim on the profile, and 404 when the
   * employee does not exist.
   */
  getProfile(viewerId: number, subjectId: number): Promise<ProfileView>;
}
