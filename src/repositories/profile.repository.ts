import { Pool, RowDataPacket } from 'mysql2/promise';
import { IProfileRepository } from '../interfaces/repositories/profile.repository.interface';
import { ProfileDocument, ProfileRecord, WorkMode } from '../models/profile.model';
import { REPORTING_TREE_CTE, reportingTreeParams } from './sql/reporting-tree';

interface ExistsRow extends RowDataPacket {
  found: number;
}

interface ProfileRow extends RowDataPacket {
  employee_id: number;
  admin_id: number | null;
  employee_code: string;
  full_name: string;
  work_email: string;
  designation: string | null;
  department: string | null;
  work_mode: WorkMode;
  work_state: string;
  shift_start: string;
  shift_end: string;
  weekly_off: string | null;
  date_of_joining: string;
  date_of_leaving: string | null;
  manager_id: number | null;
  manager_name: string | null;
  mobile: string | null;
  personal_email: string | null;
  date_of_birth: string | null;
  emergency_mobile: string | null;
  city: string | null;
  linkedin_profile: string | null;
  resume: string | null;
  aadhar_upload: string | null;
  pan_upload: string | null;
  permanent_address_proof: string | null;
  temp_address_proof: string | null;
}

/**
 * The five onboarding uploads `admins` holds, with the wording the employee
 * should see. Kept as data rather than five `if`s so adding a sixth document is
 * one line and cannot be half-implemented.
 */
const DOCUMENT_COLUMNS: { key: string; label: string; column: keyof ProfileRow }[] = [
  { key: 'resume', label: 'Resume', column: 'resume' },
  { key: 'aadhaar', label: 'Aadhaar card', column: 'aadhar_upload' },
  { key: 'pan', label: 'PAN card', column: 'pan_upload' },
  { key: 'permanentAddress', label: 'Permanent address proof', column: 'permanent_address_proof' },
  { key: 'temporaryAddress', label: 'Current address proof', column: 'temp_address_proof' },
];

export class ProfileRepository implements IProfileRepository {
  constructor(private readonly pool: Pool) {}

  async findProfile(employeeId: number): Promise<ProfileRecord | null> {
    // One query, three joins:
    //   `admins`  — personal contact details and the onboarding uploads. LEFT,
    //               because an HRMS record can exist before it is linked, and a
    //               soft-deleted admin row must read as "no details" rather
    //               than hiding the employee entirely.
    //   self join — the manager's name, so the header needs no second trip.
    const [rows] = await this.pool.execute<ProfileRow[]>(
      `SELECT e.id                       AS employee_id,
              e.admin_id,
              e.employee_code,
              e.full_name,
              e.work_email,
              e.designation,
              e.department,
              e.work_mode,
              e.work_state,
              e.shift_start,
              e.shift_end,
              e.weekly_off,
              e.date_of_joining,
              e.date_of_leaving,
              e.manager_id,
              m.full_name                AS manager_name,
              a.mobile,
              a.personal_email,
              a.date_of_birth,
              a.emergency_mobile,
              a.city,
              a.linkedin_profile,
              a.resume,
              a.aadhar_upload,
              a.pan_upload,
              a.permanent_address_proof,
              a.temp_address_proof
         FROM hrms_employees e
         LEFT JOIN admins a         ON a.id = e.admin_id AND a.deleted_at IS NULL
         LEFT JOIN hrms_employees m ON m.id = e.manager_id
        WHERE e.id = ?`,
      [employeeId],
    );

    const row = rows[0];
    return row ? this.mapProfile(row) : null;
  }

  async isInReportingTree(managerId: number, employeeId: number): Promise<boolean> {
    // Same recursive walk the approvals queue uses, including its cycle guards.
    // `LIMIT 1` stops as soon as the person is found instead of expanding the
    // rest of the tree, and a skip-level report counts just like a direct one.
    //
    // Unlike the approvals queue this does NOT exclude people who have left.
    // You cannot approve leave for someone who is gone, but their manager may
    // still need to open their profile during an exit or a handover.
    const [rows] = await this.pool.execute<ExistsRow[]>(
      `${REPORTING_TREE_CTE}
       SELECT 1 AS found FROM tree WHERE tree.id = ? LIMIT 1`,
      [...reportingTreeParams(managerId), employeeId],
    );
    return rows.length > 0;
  }

  private mapProfile(row: ProfileRow): ProfileRecord {
    return {
      employeeId: row.employee_id,
      adminId: row.admin_id,
      employeeCode: row.employee_code,
      fullName: row.full_name,
      workEmail: row.work_email,
      designation: row.designation,
      department: row.department,
      workMode: row.work_mode,
      workState: row.work_state,
      // TIME comes back as HH:MM:SS; the profile only ever shows HH:MM.
      shiftStart: row.shift_start.slice(0, 5),
      shiftEnd: row.shift_end.slice(0, 5),
      // MariaDB returns a SET column as a comma-separated string.
      weeklyOff: row.weekly_off ? row.weekly_off.split(',').filter(Boolean) : [],
      dateOfJoining: row.date_of_joining,
      dateOfLeaving: row.date_of_leaving,
      managerId: row.manager_id,
      managerName: row.manager_name,
      mobile: this.text(row.mobile),
      personalEmail: this.text(row.personal_email),
      dateOfBirth: this.text(row.date_of_birth),
      emergencyMobile: this.text(row.emergency_mobile),
      city: this.text(row.city),
      linkedinProfile: this.text(row.linkedin_profile),
      documents: this.mapDocuments(row),
    };
  }

  private mapDocuments(row: ProfileRow): ProfileDocument[] {
    const documents: ProfileDocument[] = [];
    for (const { key, label, column } of DOCUMENT_COLUMNS) {
      const path = this.text(row[column] as string | null);
      if (path) documents.push({ key, label, path });
    }
    return documents;
  }

  /**
   * `admins` is filled in by several tools over several years, so a missing
   * value arrives as NULL, an empty string or whitespace depending on which one
   * wrote it. All three mean "not on file", and the page should say so once.
   */
  private text(value: string | null): string | null {
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
}
