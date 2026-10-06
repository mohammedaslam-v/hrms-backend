import { Pool, RowDataPacket } from 'mysql2/promise';
import { IProfileRepository } from './profile.repository.interface';
import { DismissEmployeeDto, DocumentKey, ProfileDocument, ProfileRecord, UpdatePersonalDetailsDto, WorkMode } from './profile.model';

interface ProfileRow extends RowDataPacket {
  employee_id: number;
  admin_id: number | null;
  employee_code: string;
  full_name: string;
  work_email: string;
  designation: string | null;
  department: string | null;
  employment_type: string | null;
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
  emergency_contact_name: string | null;
  emergency_contact_relation: string | null;
  profile_gate_exempt: number | null;
  city: string | null;
  linkedin_profile: string | null;
  resume: string | null;
  aadhar_upload: string | null;
  pan_upload: string | null;
  permanent_address_proof: string | null;
  temp_address_proof: string | null;
  aadhar_number: string | null;
  pan_number: string | null;
  confirmation_date: string | null;
  uan: string | null;
  pf_number: string | null;
  bank_name: string | null;
  ifsc_code: string | null;
  account_no: string | null;
  hrms_role?: "employee" | "admin";
  is_manager_override?: number;
  has_active_reports?: number;
  opening_leave?: string | number;

  is_login_disabled: number | boolean;
  login_disabled_at: string | null;
  is_salary_stopped: number | boolean;
  salary_stopped_at: string | null;
  salary_stop_reason: string | null;
  resignation_date: string | null;
  resignation_reason: string | null;
  is_notice_serving: number | boolean;
  last_working_day: string | null;
  is_rehire_eligible: number | boolean;
  exit_notes: string | null;
  deleted_at: string | null;
}

const DOCUMENT_COLUMNS: { key: DocumentKey; label: string; column: keyof ProfileRow; numberColumn?: keyof ProfileRow }[] = [
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
              COALESCE(e.employment_type, "Employee") AS employment_type,
              e.work_mode,
              e.work_state,
              e.shift_start,
              e.shift_end,
              e.weekly_off,
              e.date_of_joining,
              e.date_of_leaving,
              e.confirmation_date,
              e.uan,
              e.pf_number,
              COALESCE(e.bank_name, a.bank_name) AS bank_name,
              COALESCE(e.ifsc_code, a.ifsc_code) AS ifsc_code,
              COALESCE(e.account_no, a.account_no) AS account_no,
              e.manager_id,
              m.full_name                AS manager_name,
              COALESCE(a.mobile, e.phone) AS mobile,
              a.personal_email,
              COALESCE(a.date_of_birth, e.date_of_birth) AS date_of_birth,
              -- HRMS's own value wins; admins is the legacy fallback, the same
              -- way bank_name, ifsc_code and account_no above resolve.
              COALESCE(e.emergency_contact_number, a.emergency_mobile) AS emergency_mobile,
              e.emergency_contact_name,
              e.emergency_contact_relation,
              e.profile_gate_exempt,
              a.city,
              a.linkedin_profile,
              a.resume,
              a.aadhar_upload,
              a.pan_upload,
              a.permanent_address_proof,
              a.temp_address_proof,
              a.aadhar_number,
              COALESCE(a.pan, e.pan)     AS pan_number,
              e.is_login_disabled,
              e.login_disabled_at,
              e.is_salary_stopped,
              e.salary_stopped_at,
              e.salary_stop_reason,
              e.resignation_date,
              e.resignation_reason,
              e.is_notice_serving,
              e.last_working_day,
              e.is_rehire_eligible,
              e.exit_notes,
              e.deleted_at,
              e.hrms_role,
              e.is_manager_override,
              e.opening_leave,
              EXISTS(SELECT 1 FROM hrms_employees rep WHERE rep.manager_id = e.id AND rep.deleted_at IS NULL) AS has_active_reports
         FROM hrms_employees e
         LEFT JOIN admins a         ON a.id = e.admin_id AND a.deleted_at IS NULL
         LEFT JOIN hrms_employees m ON m.id = e.manager_id
        WHERE e.id = ?`,
      [employeeId],
    );

    const row = rows[0];
    if (!row) return null;
    const profile = this.mapProfile(row);
    try {
      const [customDocs] = await this.pool.execute<RowDataPacket[]>(
        `SELECT doc_key, doc_name, doc_number, file_path
           FROM hrms_employee_documents
          WHERE employee_id = ?
          ORDER BY id ASC`,
        [employeeId],
      );
      for (const cd of customDocs) {
        profile.documents.push({
          key: cd.doc_key,
          label: cd.doc_name,
          path: cd.file_path || '',
          docNumber: cd.doc_number || null,
        });
        if (cd.doc_key === 'aadhaar' && !profile.aadharNumber && cd.doc_number) {
          profile.aadharNumber = cd.doc_number;
        }
        if (cd.doc_key === 'pan' && !profile.panNumber && cd.doc_number) {
          profile.panNumber = cd.doc_number;
        }
      }
    } catch {
      // Custom docs table might not exist yet
    }
    return profile;
  }

  async findByEmployeeCode(employeeCode: string): Promise<{ id: number; fullName: string } | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, full_name FROM hrms_employees WHERE employee_code = ? LIMIT 1`,
      [employeeCode],
    );
    if (!rows.length) return null;
    return { id: Number(rows[0].id), fullName: String(rows[0].full_name) };
  }

  async updateDocument(
    employeeId: number,
    adminId: number | null,
    key: DocumentKey,
    filePath?: string | null,
    docNumber?: string | null,
    label?: string | null,
    addedBy?: number,
  ): Promise<void> {
    const columnMap: Record<string, { fileCol?: string; numCol?: string }> = {
      pan: { fileCol: 'pan_upload', numCol: 'pan' },
      aadhaar: { fileCol: 'aadhar_upload', numCol: 'aadhar_number' },
      resume: { fileCol: 'resume' },
      permanentAddress: { fileCol: 'permanent_address_proof' },
      temporaryAddress: { fileCol: 'temp_address_proof' },
    };

    const target = columnMap[key];
    if (target) {
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

      if (key === 'pan' && docNumber !== undefined) {
        await this.pool.execute(
          `UPDATE hrms_employees SET pan = ? WHERE id = ?`,
          [docNumber ? docNumber.trim() : null, employeeId],
        );
      }
      return;
    }

    try {
      if (filePath === null && docNumber === null) {
        await this.pool.execute(
          `DELETE FROM hrms_employee_documents WHERE employee_id = ? AND doc_key = ?`,
          [employeeId, key],
        );
      } else {
        const docName = label?.trim() || key;
        await this.pool.execute(
          `INSERT INTO hrms_employee_documents
             (employee_id, doc_key, doc_name, doc_number, file_path, added_by)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             doc_name = VALUES(doc_name),
             doc_number = VALUES(doc_number),
             file_path = COALESCE(VALUES(file_path), file_path),
             updated_at = CURRENT_TIMESTAMP`,
          [
            employeeId,
            key,
            docName,
            docNumber ? docNumber.trim() : null,
            filePath || null,
            addedBy || employeeId,
          ],
        );
      }
    } catch (err: any) {
      if (err.code === 'ER_NO_SUCH_TABLE') {
        console.warn('hrms_employee_documents table not created yet');
      } else {
        throw err;
      }
    }
  }

  async findDocumentPath(employeeId: number, key: DocumentKey): Promise<string | null> {
    const columnMap: Record<string, string> = {
      pan: 'a.pan_upload',
      aadhaar: 'a.aadhar_upload',
      resume: 'a.resume',
      permanentAddress: 'a.permanent_address_proof',
      temporaryAddress: 'a.temp_address_proof',
    };
    const col = columnMap[key];
    if (col) {
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

    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT file_path AS doc_path
           FROM hrms_employee_documents
          WHERE employee_id = ? AND doc_key = ?`,
        [employeeId, key],
      );
      const path = rows[0]?.doc_path as string | null;
      return path ? path.trim() : null;
    } catch {
      return null;
    }
  }

  async updateLoginDisabled(employeeId: number, disabled: boolean): Promise<void> {
    await this.pool.execute(
      `UPDATE hrms_employees
          SET is_login_disabled = ?,
              login_disabled_at = CASE WHEN ? = 1 THEN NOW() ELSE NULL END
        WHERE id = ?`,
      [disabled ? 1 : 0, disabled ? 1 : 0, employeeId],
    );

    if (disabled) {
      await this.pool.execute(
        `UPDATE hrms_sessions
            SET revoked_at = NOW(),
                revoked_reason = 'login_disabled_by_admin'
          WHERE employee_id = ? AND revoked_at IS NULL`,
        [employeeId],
      );
    }
  }

  async dismissEmployee(employeeId: number, dto: DismissEmployeeDto): Promise<void> {
    const lastWorking = dto.lastWorkingDay ? dto.lastWorkingDay.slice(0, 10) : null;
    const resignation = dto.resignationDate ? dto.resignationDate.slice(0, 10) : null;

    await this.pool.execute(
      `UPDATE hrms_employees
          SET resignation_date = ?,
              resignation_reason = ?,
              is_notice_serving = ?,
              last_working_day = ?,
              date_of_leaving = ?,
              is_rehire_eligible = ?,
              exit_notes = ?
        WHERE id = ?`,
      [
        resignation,
        dto.resignationReason?.trim() || null,
        dto.isNoticeServing ? 1 : 0,
        lastWorking,
        lastWorking,
        dto.isRehireEligible ? 1 : 0,
        dto.exitNotes?.trim() || null,
        employeeId,
      ],
    );
  }

  async updateSalaryStopped(employeeId: number, stopped: boolean, reason?: string | null): Promise<void> {
    await this.pool.execute(
      `UPDATE hrms_employees
          SET is_salary_stopped = ?,
              salary_stopped_at = CASE WHEN ? = 1 THEN NOW() ELSE NULL END,
              salary_stop_reason = ?
        WHERE id = ?`,
      [
        stopped ? 1 : 0,
        stopped ? 1 : 0,
        stopped ? (reason?.trim() || null) : null,
        employeeId,
      ],
    );
  }

  async updateWorkMode(employeeId: number, workMode: string): Promise<void> {
    await this.pool.execute(
      `UPDATE hrms_employees SET work_mode = ? WHERE id = ?`,
      [workMode, employeeId],
    );
  }

    async updatePersonalDetails(employeeId: number, dto: UpdatePersonalDetailsDto): Promise<void> {
    const [empRows] = await this.pool.execute<any[]>(
      `SELECT id, admin_id FROM hrms_employees WHERE id = ?`,
      [employeeId],
    );
    if (!empRows.length) return;
    const adminId = empRows[0].admin_id;

    const empUpdates: string[] = [];
    const empValues: any[] = [];

    if (dto.employeeCode !== undefined) {
      empUpdates.push(`employee_code = ?`);
      empValues.push(dto.employeeCode?.trim() ? dto.employeeCode.trim().toUpperCase() : null);
    }
    if (dto.fullName !== undefined) {
      empUpdates.push(`full_name = ?`);
      empValues.push(dto.fullName?.trim() || null);
    }
    if (dto.designation !== undefined) {
      empUpdates.push(`designation = ?`);
      empValues.push(dto.designation?.trim() || null);
    }
    if (dto.department !== undefined) {
      empUpdates.push(`department = ?`);
      empValues.push(dto.department?.trim() || null);
    }
    if (dto.email !== undefined) {
      empUpdates.push(`work_email = ?`);
      empValues.push(dto.email?.trim() || null);
    }
    if (dto.mobile !== undefined) {
      empUpdates.push(`phone = ?`);
      empValues.push(dto.mobile?.trim() || null);
    }
    if (dto.dateOfBirth !== undefined) {
      empUpdates.push(`date_of_birth = ?`);
      empValues.push(dto.dateOfBirth?.trim() || null);
    }
    if (dto.pan !== undefined) {
      empUpdates.push(`pan = ?`);
      empValues.push(dto.pan?.trim() ? dto.pan.trim().toUpperCase() : null);
    }
    if (dto.workLocation !== undefined) {
      empUpdates.push(`work_state = ?`);
      empValues.push(dto.workLocation?.trim() || null);
    }
    if (dto.shiftStart !== undefined) {
      empUpdates.push(`shift_start = ?`);
      const s = dto.shiftStart?.trim() || "10:00:00";
      empValues.push(s.length === 5 ? `${s}:00` : s);
    }
    if (dto.shiftEnd !== undefined) {
      empUpdates.push(`shift_end = ?`);
      const s = dto.shiftEnd?.trim() || "19:00:00";
      empValues.push(s.length === 5 ? `${s}:00` : s);
    }
    if (dto.weeklyOff !== undefined) {
      let daysStr = "";
      if (Array.isArray(dto.weeklyOff)) {
        daysStr = dto.weeklyOff.filter(Boolean).join(",");
      } else if (typeof dto.weeklyOff === "string") {
        daysStr = dto.weeklyOff.trim();
      }
      empUpdates.push(`weekly_off = ?`);
      empValues.push(daysStr || "Sun");
    }
    if (dto.dateOfJoining !== undefined) {
      empUpdates.push(`date_of_joining = ?`);
      empValues.push(dto.dateOfJoining?.trim() || null);
    }
    if (dto.managerId !== undefined) {
      const mId = dto.managerId ? Number(dto.managerId) : null;
      empUpdates.push(`manager_id = ?`);
      empValues.push(mId && mId > 0 ? mId : null);
    }
    if (dto.role !== undefined && dto.role !== null) {
      if (dto.role === "admin") {
        empUpdates.push(`hrms_role = 'admin', is_manager_override = 1`);
      } else if (dto.role === "manager") {
        empUpdates.push(`hrms_role = 'employee', is_manager_override = 1`);
      } else {
        empUpdates.push(`hrms_role = 'employee', is_manager_override = 0`);
      }
    }
    if ((dto as any).leaveBalanceDiff !== undefined && !isNaN(Number((dto as any).leaveBalanceDiff))) {
      const diff = Number((dto as any).leaveBalanceDiff);
      empUpdates.push(`opening_leave = GREATEST(0, ROUND(opening_leave + ?, 1))`);
      empValues.push(diff);
    }

    if (dto.confirmationDate !== undefined) {
      empUpdates.push(`confirmation_date = ?`);
      empValues.push(dto.confirmationDate?.trim() ? dto.confirmationDate.trim().slice(0, 10) : null);
    }
    if (dto.dateOfLeaving !== undefined) {
      empUpdates.push(`date_of_leaving = ?`);
      empValues.push(dto.dateOfLeaving?.trim() ? dto.dateOfLeaving.trim().slice(0, 10) : null);
    }
    if (dto.uan !== undefined) {
      empUpdates.push(`uan = ?`);
      empValues.push(dto.uan?.trim() || null);
    }
    if (dto.pfNumber !== undefined) {
      empUpdates.push(`pf_number = ?`);
      empValues.push(dto.pfNumber?.trim() || null);
    }
    if (dto.bankName !== undefined) {
      empUpdates.push(`bank_name = ?`);
      empValues.push(dto.bankName?.trim() || null);
    }
    if (dto.ifscCode !== undefined) {
      empUpdates.push(`ifsc_code = ?`);
      empValues.push(dto.ifscCode?.trim() ? dto.ifscCode.trim().toUpperCase() : null);
    }
    if (dto.accountNo !== undefined) {
      empUpdates.push(`account_no = ?`);
      empValues.push(dto.accountNo?.trim() || null);
    }
    // Emergency contact is written here and nowhere else. `admins` has only a
    // number and no column for the name or the relationship, and this portal
    // does not alter that table — the read COALESCEs over it instead.
    if (dto.emergencyContactName !== undefined) {
      empUpdates.push(`emergency_contact_name = ?`);
      empValues.push(dto.emergencyContactName?.trim() || null);
    }
    if (dto.emergencyContactNumber !== undefined) {
      empUpdates.push(`emergency_contact_number = ?`);
      empValues.push(dto.emergencyContactNumber?.trim() || null);
    }
    if (dto.emergencyContactRelation !== undefined) {
      empUpdates.push(`emergency_contact_relation = ?`);
      empValues.push(dto.emergencyContactRelation?.trim() || null);
    }

    if (empUpdates.length > 0) {
      empUpdates.push(`updated_at = NOW()`);
      empValues.push(employeeId);
      await this.pool.execute(
        `UPDATE hrms_employees SET ${empUpdates.join(', ')} WHERE id = ?`,
        empValues,
      );
    }

    if (adminId) {
      const adminUpdates: string[] = [];
      const adminValues: any[] = [];

      if (dto.fullName !== undefined) {
        adminUpdates.push(`name = ?`);
        adminValues.push(dto.fullName?.trim() || null);
      }
      if (dto.email !== undefined) {
        adminUpdates.push(`email = ?`);
        adminValues.push(dto.email?.trim() || null);
      }
      if (dto.mobile !== undefined) {
        adminUpdates.push(`mobile = ?`);
        adminValues.push(dto.mobile?.trim() || null);
      }
      if (dto.dateOfBirth !== undefined) {
        adminUpdates.push(`date_of_birth = ?`);
        adminValues.push(dto.dateOfBirth?.trim() || null);
      }
      if (dto.pan !== undefined) {
        adminUpdates.push(`pan = ?`);
        adminValues.push(dto.pan?.trim() ? dto.pan.trim().toUpperCase() : null);
      }
      if (dto.aadhar !== undefined) {
        adminUpdates.push(`aadhar_number = ?`);
        adminValues.push(dto.aadhar?.trim() || null);
      }
      if (dto.bankName !== undefined) {
        adminUpdates.push(`bank_name = ?`);
        adminValues.push(dto.bankName?.trim() || null);
      }
      if (dto.ifscCode !== undefined) {
        adminUpdates.push(`ifsc_code = ?`);
        adminValues.push(dto.ifscCode?.trim() ? dto.ifscCode.trim().toUpperCase() : null);
      }
      if (dto.accountNo !== undefined) {
        adminUpdates.push(`account_no = ?`);
        adminValues.push(dto.accountNo?.trim() || null);
      }

      if (adminUpdates.length > 0) {
        adminUpdates.push(`updated_at = NOW()`);
        adminValues.push(adminId);
        await this.pool.execute(
          `UPDATE admins SET ${adminUpdates.join(', ')} WHERE id = ?`,
          adminValues,
        );
      }
    }

    if (dto.pan !== undefined) {
      try {
        await this.pool.execute(
          `UPDATE hrms_employee_documents SET doc_number = ? WHERE employee_id = ? AND doc_key = 'pan'`,
          [dto.pan?.trim() ? dto.pan.trim().toUpperCase() : null, employeeId]
        );
      } catch {}
    }
    if (dto.aadhar !== undefined) {
      try {
        const [res]: any = await this.pool.execute(
          `UPDATE hrms_employee_documents SET doc_number = ? WHERE employee_id = ? AND doc_key = 'aadhaar'`,
          [dto.aadhar?.trim() || null, employeeId]
        );
        if (res && res.affectedRows === 0 && !adminId && dto.aadhar?.trim()) {
          await this.pool.execute(
            `INSERT INTO hrms_employee_documents (employee_id, doc_key, doc_name, doc_number, file_path)
             VALUES (?, 'aadhaar', 'Aadhaar Card', ?, '')`,
            [employeeId, dto.aadhar.trim()]
          );
        }
      } catch {}
    }
  }

async updateEmploymentType(employeeId: number, employmentType: string): Promise<void> {
    await this.pool.execute(
      `UPDATE hrms_employees SET employment_type = ? WHERE id = ?`,
      [employmentType, employeeId],
    );
  }

  async deleteEmployee(employeeId: number, adminId: number | null): Promise<void> {
    await this.pool.execute(
      `UPDATE hrms_employees SET deleted_at = NOW() WHERE id = ?`,
      [employeeId],
    );

    if (adminId) {
      await this.pool.execute(
        `UPDATE admins SET deleted_at = NOW() WHERE id = ?`,
        [adminId],
      );
    }

    await this.pool.execute(
      `UPDATE hrms_sessions
          SET revoked_at = NOW(),
              revoked_reason = 'employee_deleted_by_admin'
        WHERE employee_id = ? AND revoked_at IS NULL`,
      [employeeId],
    );
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
      employmentType: (() => {
        const raw = ((row.employment_type as string) || "").toLowerCase();
        if (raw.includes("contract") || Boolean(row.designation && row.designation.toLowerCase().includes("contract")) || Boolean(row.department && row.department.toLowerCase().includes("contract"))) return "Contractor";
        if (raw.includes("probation")) return "Probation";
        return "Employee";
      })(),
      isContractor: ((row.employment_type as string) || "").toLowerCase().includes("contract") ||
        Boolean(row.designation && row.designation.toLowerCase().includes("contract")) ||
        Boolean(row.department && row.department.toLowerCase().includes("contract")),
      workMode: row.work_mode,
      workState: row.work_state,
      shiftStart: row.shift_start.slice(0, 5),
      shiftEnd: row.shift_end.slice(0, 5),
      weeklyOff: row.weekly_off ? row.weekly_off.split(',').filter(Boolean) : [],
      dateOfJoining: row.date_of_joining,
      dateOfLeaving: row.date_of_leaving ? String(row.date_of_leaving).slice(0, 10) : null,
      confirmationDate: row.confirmation_date ? String(row.confirmation_date).slice(0, 10) : null,
      uan: this.text(row.uan),
      pfNumber: this.text(row.pf_number),
      bankName: this.text(row.bank_name),
      ifscCode: this.text(row.ifsc_code),
      accountNo: this.text(row.account_no),
      managerId: row.manager_id,
      managerName: row.manager_name,
      hrmsRole: row.hrms_role,
      isManagerOverride: row.is_manager_override === 1,
      role: row.hrms_role === "admin" ? "admin" : (row.is_manager_override === 1 || row.has_active_reports === 1 ? "manager" : "employee"),
      mobile: this.text(row.mobile),
      personalEmail: this.text(row.personal_email),
      dateOfBirth: this.text(row.date_of_birth),
      emergencyMobile: this.text(row.emergency_mobile),
      emergencyContactName: this.text(row.emergency_contact_name),
      emergencyContactRelation: this.text(row.emergency_contact_relation),
      profileGateExempt: Boolean(row.profile_gate_exempt),
      city: this.text(row.city),
      panNumber: this.text(row.pan_number),
      aadharNumber: this.text(row.aadhar_number),
      linkedinProfile: this.text(row.linkedin_profile),
      documents: this.mapDocuments(row),

      isLoginDisabled: Boolean(row.is_login_disabled),
      loginDisabledAt: row.login_disabled_at ? String(row.login_disabled_at) : null,
      isSalaryStopped: Boolean(row.is_salary_stopped),
      salaryStoppedAt: row.salary_stopped_at ? String(row.salary_stopped_at) : null,
      salaryStopReason: this.text(row.salary_stop_reason ?? null),
      resignationDate: row.resignation_date ? String(row.resignation_date) : null,
      resignationReason: this.text(row.resignation_reason ?? null),
      isNoticeServing: row.is_notice_serving === undefined ? true : Boolean(row.is_notice_serving),
      lastWorkingDay: row.last_working_day ? String(row.last_working_day) : null,
      isRehireEligible: row.is_rehire_eligible === undefined ? true : Boolean(row.is_rehire_eligible),
      exitNotes: this.text(row.exit_notes ?? null),
      deletedAt: row.deleted_at ? String(row.deleted_at) : null,
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

  private text(value: any): string | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) {
      const y = value.getFullYear();
      const m = String(value.getMonth() + 1).padStart(2, "0");
      const d = String(value.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    const trimmed = String(value).trim();
    return trimmed === '' ? null : trimmed;
  }
}
