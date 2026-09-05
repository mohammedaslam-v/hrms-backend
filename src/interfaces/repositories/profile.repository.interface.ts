import { ProfileRecord } from '../../models/profile.model';

export interface IProfileRepository {
  /**
   * The whole profile in one round trip: the HRMS record, the manager's name,
   * and the personal details and onboarding documents held in `admins`.
   *
   * Returns null when the id does not exist, so callers distinguish "no such
   * employee" from "an employee with nothing filled in".
   */
  findProfile(employeeId: number): Promise<ProfileRecord | null>;

  /**
   * Is `employeeId` anywhere below `managerId` in the reporting tree?
   *
   * Answers the authorization question directly rather than returning the tree
   * to be searched: a skip-level manager can have hundreds of reports, and
   * whether one particular person is among them is a single row of work.
   */
  isInReportingTree(managerId: number, employeeId: number): Promise<boolean>;
}
