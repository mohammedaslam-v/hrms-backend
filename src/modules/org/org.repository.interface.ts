import { TeamMember } from './org.model';

/**
 * Who reports to whom.
 *
 * Its own module rather than a helper shared between leave and profile: the
 * reporting structure is a business concept in its own right, and leave
 * approvals, profile access, goals and payroll all legitimately depend on it.
 * One owner means the two questions below can never be answered by two
 * different queries that disagree.
 */
export interface IOrgRepository {
  /**
   * Everyone below `managerId`, including skip-level reports. Excludes people
   * who have left — you do not approve leave for someone who is gone.
   */
  findReportingTree(managerId: number): Promise<TeamMember[]>;

  /**
   * Is `employeeId` anywhere below `managerId`?
   *
   * Answers the authorization question directly instead of returning the tree
   * to be searched. Unlike `findReportingTree` this does NOT exclude leavers:
   * a manager may still need to open a former report's profile during an exit
   * or a handover.
   */
  isInReportingTree(managerId: number, employeeId: number): Promise<boolean>;
}
