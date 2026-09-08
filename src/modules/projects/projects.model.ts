export type ProjectStatus = 'In progress' | 'Live' | 'Done';

/**
 * A piece of work someone is known for.
 *
 * Recorded by a manager or admin, never self-serve — `added_by` says who, so an
 * entry on somebody's profile is always attributable.
 */
export interface ProjectRecord {
  id: number;
  employeeId: number;
  title: string;
  status: ProjectStatus;
  note: string | null;
  startedOn: string | null;
  addedBy: number;
  addedByName: string | null;
}

/** What a manager supplies when recording a project. */
export interface AddProjectInput {
  employeeId: number;
  title: string;
  status: ProjectStatus;
  note: string | null;
  startedOn: string | null;
  addedBy: number;
}
