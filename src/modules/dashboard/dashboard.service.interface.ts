import { DashboardView } from './dashboard.model';

export interface IDashboardService {
  /**
   * The operations dashboard for whoever is asking.
   *
   * Scope is resolved inside: an admin gets the company, a manager gets their
   * reporting tree, and anybody else is refused. The caller passes only who
   * they are — never what they want to see.
   */
  getDashboard(viewerId: number): Promise<DashboardView>;
}
