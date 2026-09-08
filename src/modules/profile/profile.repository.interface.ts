import { ProfileRecord } from './profile.model';

export interface IProfileRepository {
  /**
   * The whole profile in one round trip: the HRMS record, the manager's name,
   * and the personal details and onboarding documents held in `admins`.
   *
   * Returns null when the id does not exist, so callers distinguish "no such
   * employee" from "an employee with nothing filled in".
   */
  findProfile(employeeId: number): Promise<ProfileRecord | null>;
}
