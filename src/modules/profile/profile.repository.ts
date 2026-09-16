import { Pool, RowDataPacket } from 'mysql2/promise';
import { IProfileRepository } from './profile.repository.interface';
import { DocumentKey, ProfileDocument, ProfileRecord, WorkMode } from './profile.model';

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
  aadhar_number: string | null;
  pan_number: string | null;
}

const DOCUMENT_COLUMNS: {
  key: DocumentKey;
  label: string;
  column: keyof ProfileRow;
  numberColumn?: keyof ProfileRow;
}[] = [
  { key: 'pan', label: 'PAN card', column: 'pan_upload', numberColumn: 'pan_number' },
  { key: 'aadhaar', label: 'Aadhaar card', column: 'aadhar_upload', numberColumn: 'aadhar_number' },
  { key: 'resume', label: 'Resume', column: 'resume' },
  { key: 'permanentAddress', label: 'Permanent address proof', column: 'permanent_address_proof' },
  { key: 'temporaryAddress', label: 'Current address proof', column: 'temp_address_proof' },
];

export class ProfileRepository implements IProfileRepository {
  constructor(private readonly pool: Pool) {}

  async findProfile(employeeId: number): Promise<ProfileRecord | null> {
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
              a.temp_address_proof,
              a.aadhar_number,
              COALESCE(a.pan, e.pan)     AS pan_number
         FROM hrms_employees e
         LEFT JOIN admins a         ON a.id = e.admin_id AND a.deleted_at IS NULL
         LEFT JOIN hrms_employees m ON m.id = e.manager_id
        WHERE e.id = ?`,
      [employeeId],
    );

    const row = rows[0];
    return row ? this.mapProfile(row) : null;
  }

  async updateDocument(
    employeeId: number,
    adminId: number | null,
    key: DocumentKey,
    filePath?: string | null,
    docNumber?: string | null,
  ): Promise<void> {
    const columnMap: Record<DocumentKey, { fileCol?: string; numCol?: string }> = {
      pan: { fileCol: 'pan_upload', numCol: 'pan' },
      aadhaar: { fileCol: 'aadhar_upload', numCol: 'aadhar_number' },
      resume: { fileCol: 'resume' },
      permanentAddress: { fileCol: 'permanent_address_proof' },
      temporaryAddress: { fileCol: 'temp_address_proof' },
    };

    const target = columnMap[key];
    if (!target) return;

    if (adminId) {
      const updates: string[] = [];
      const values: (string | null | number)[] = [];

      if (target.fileCol && filePath !== undefined) {
        updates.push(`${target.fileCol} = ?`);
        values.push(filePath || null);
      }
      if (target.numCol && docNumber !== undefined) {
        updates.push(`${target.numCol} = ?`);
        values.push(docNumber ? docNumber.trim() : null);
      }

      if (updates.length > 0) {
        values.push(adminId);
        await this.pool.execute(
          `UPDATE admins SET ${updates.join(', ')} WHERE id = ?`,
          values,
        );
      }
    }

    // Keep hrms_employees.pan in sync if updating PAN number
    if (key === 'pan' && docNumber !== undefined) {
      await this.pool.execute(
        `UPDATE hrms_employees SET pan = ? WHERE id = ?`,
        [docNumber ? docNumber.trim() : null, employeeId],
      );
    }
  }

  async findDocumentPath(employeeId: number, key: DocumentKey): Promise<string | null> {
    const columnMap: Record<DocumentKey, string> = {
      pan: 'a.pan_upload',
      aadhaar: 'a.aadhar_upload',
      resume: 'a.resume',
      permanentAddress: 'a.permanent_address_proof',
      temporaryAddress: 'a.temp_address_proof',
    };
    const col = columnMap[key];
    if (!col) return null;

    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT ${col} AS doc_path
         FROM hrms_employees e
         JOIN admins a ON a.id = e.admin_id
        WHERE e.id = ?`,
      [employeeId],
    );
    const path = rows[0]?.doc_path as string | null;
    return path ? path.trim() : null;
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
      shiftStart: row.shift_start.slice(0, 5),
      shiftEnd: row.shift_end.slice(0, 5),
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
    for (const { key, label, column, numberColumn } of DOCUMENT_COLUMNS) {
      const path = this.text(row[column] as string | null);
      const docNumber = numberColumn ? this.text(row[numberColumn] as string | null) : null;
      if (path || docNumber) {
        documents.push({
          key,
          label,
          path: path || '',
          docNumber: docNumber || null,
        });
      }
    }
    return documents;
  }

  private text(value: string | null): string | null {
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
}
