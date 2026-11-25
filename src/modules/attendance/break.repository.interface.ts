import type { BreakRecord } from './break.domain';
import type { ZoneKind } from './geofence.domain';

export type BreakEndReason = 'self' | 'checkout' | 'auto';

export interface StartBreakInput {
  employeeId: number;
  attendanceId: number;
  workDate: string;
  /** 'YYYY-MM-DD HH:MM', from the database clock. */
  startedAt: string;
  endsBy: string;
  device: string;
  deviceLabel: string | null;
  zone: ZoneKind | null;
}

export interface EndBreakInput {
  id: number;
  endedAt: string;
  reason: BreakEndReason;
  device: string | null;
  zone: ZoneKind | null;
}

/** `hrms_attendance_breaks` — one row per break. */
export interface IBreakRepository {
  /** Every break of one shift day, oldest first. */
  findForShift(employeeId: number, workDate: string): Promise<BreakRecord[]>;
  /** Any break with no stored end, whatever its day. At most one (unique key). */
  findOpen(employeeId: number): Promise<(BreakRecord & { workDate: string }) | null>;
  /** The new id, or null when another break is already open (lost a race). */
  start(input: StartBreakInput): Promise<number | null>;
  /** False when it was already ended. */
  end(input: EndBreakInput): Promise<boolean>;
}
