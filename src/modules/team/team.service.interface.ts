import { DirectoryView } from './team.model';

export interface ITeamService {
  /**
   * The Team directory for whoever is asking.
   *
   * An admin gets the whole company; a manager gets their reporting tree,
   * skip-level included. Anyone else is refused — the page is Manager access.
   */
  getDirectory(viewerId: number, includeLeavers?: boolean): Promise<DirectoryView>;
}
