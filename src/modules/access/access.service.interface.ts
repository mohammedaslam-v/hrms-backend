import { GrantedAccess, ProfileAccess } from './access.domain';

export interface IAccessService {
  /**
   * What `viewerId` is allowed to do with `subjectId`'s record.
   *
   * One implementation, used by the profile read and by every write about a
   * person, so the three can never disagree about who a manager is.
   */
  resolveFor(viewerId: number, subjectId: number): Promise<ProfileAccess>;

  /**
   * The same, but refuses instead of returning 'denied' — for the callers whose
   * next line would otherwise have to throw the identical error.
   */
  require(viewerId: number, subjectId: number): Promise<GrantedAccess>;
}
