import { RosterMember, RosterScope, TeamMember } from './org.model';

/**
 * Who reports to whom.
 *
 * Its own module rather than a helper shared between leave and profile: the
 * reporting structure is a business concept in its own right, and leave
 * approvals, profile access, goals and payroll all legitimately depend on it.
 * One owner means these questions can never be answered by two different
 * queries that disagree.
 */
export interface IOrgRepository {
  /**
   * Everyone below `managerId`, including skip-level reports.
   *
   * Excludes people who have left unless asked otherwise — you do not approve
   * leave for someone who is gone, but a directory still lists them.
   */
  findReportingTree(managerId: number, includeLeavers?: boolean): Promise<TeamMember[]>;

  /**
   * Is `employeeId` anywhere below `managerId`?
   *
   * Answers the authorization question directly instead of returning the tree
   * to be searched. Always includes leavers: a manager may still need to open a
   * former report's profile during an exit or a handover.
   */
  isInReportingTree(managerId: number, employeeId: number): Promise<boolean>;

  /**
   * The Team directory's list — a manager's tree, or the whole company.
   *
   * One query either way. The manager's name comes from a self join in the same
   * statement, so a list of 450 people costs one round trip rather than 451.
   */
  findRoster(scope: RosterScope): Promise<RosterMember[]>;
}
