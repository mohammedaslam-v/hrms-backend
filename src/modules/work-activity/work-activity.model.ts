/**
 * Work done away from the system — a phone call, an outside meeting — that an
 * employee records against a day so it counts towards their active hours.
 */
export type WorkActivityType = 'phone_call' | 'external_meeting' | 'other';

export interface WorkActivity {
  id: number;
  employeeId: number;
  date: string;
  type: WorkActivityType;
  /** HH:MM, India time. */
  startTime: string;
  endTime: string;
  note: string | null;
  createdAt: string;
}

export interface CreateWorkActivityDto {
  date: string;
  type: WorkActivityType;
  startTime: string;
  endTime: string;
  note: string | null;
}

export interface WorkActivityRange {
  /** The dates the viewer may still add to or delete from, newest first. */
  editableDates: string[];
  /** Whether the viewer is the person themselves (only they may add). */
  canEdit: boolean;
  activities: WorkActivity[];
}
