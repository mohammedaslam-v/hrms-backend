import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import {
  CreateOtpInput,
  IAuthRepository,
} from '../interfaces/repositories/auth.repository.interface';
import {
  AuthenticatedEmployee,
  EmployeeCredentials,
  OtpPurpose,
  SessionContext,
  StoredOtp,
  TierInputs,
} from '../models/auth.model';

interface OtpRow extends RowDataPacket {
  id: number;
  employee_id: number;
  purpose: OtpPurpose;
  code_hash: string;
  attempts: number;
  max_attempts: number;
  is_expired: number;
  is_consumed: number;
}

interface ScalarRow extends RowDataPacket {
  value: string | number | null;
}

interface DeliveryRow extends RowDataPacket {
  work_email: string | null;
  mobile: string | null;
}

interface CredentialsRow extends RowDataPacket {
  employee_id: number;
  admin_id: number | null;
  password_hash: string | null;
  date_of_leaving: string | null;
}

interface TierRow extends RowDataPacket {
  hrms_role: 'employee' | 'admin';
  is_manager_override: number;
  has_active_reports: number;
}

interface ProfileRow extends RowDataPacket {
  id: number;
  employee_code: string;
  full_name: string;
  work_email: string;
  department: string | null;
  designation: string | null;
  date_of_joining: string;
}

interface SessionRow extends RowDataPacket {
  id: number;
  employee_id: number;
}

export class AuthRepository implements IAuthRepository {
  constructor(private readonly pool: Pool) {}

  async findCredentialsByWorkEmail(workEmail: string): Promise<EmployeeCredentials | null> {
    // The password still lives in `admins` — HRMS reads it and never writes to that table.
    const [rows] = await this.pool.execute<CredentialsRow[]>(
      `SELECT e.id            AS employee_id,
              e.admin_id      AS admin_id,
              a.password      AS password_hash,
              e.date_of_leaving
         FROM hrms_employees e
         LEFT JOIN admins a ON a.id = e.admin_id AND a.deleted_at IS NULL
        WHERE e.work_email = ?`,
      [workEmail],
    );

    const row = rows[0];
    if (!row) return null;

    return {
      employeeId: row.employee_id,
      adminId: row.admin_id,
      passwordHash: row.password_hash,
      dateOfLeaving: row.date_of_leaving,
    };
  }

  async findCredentialsByEmployeeId(employeeId: number): Promise<EmployeeCredentials | null> {
    const [rows] = await this.pool.execute<CredentialsRow[]>(
      `SELECT e.id       AS employee_id,
              e.admin_id AS admin_id,
              a.password AS password_hash,
              e.date_of_leaving
         FROM hrms_employees e
         LEFT JOIN admins a ON a.id = e.admin_id AND a.deleted_at IS NULL
        WHERE e.id = ?`,
      [employeeId],
    );

    const row = rows[0];
    if (!row) return null;

    return {
      employeeId: row.employee_id,
      adminId: row.admin_id,
      passwordHash: row.password_hash,
      dateOfLeaving: row.date_of_leaving,
    };
  }

  async findDeliveryTargets(
    employeeId: number,
  ): Promise<{ email: string | null; mobile: string | null } | null> {
    const [rows] = await this.pool.execute<DeliveryRow[]>(
      `SELECT e.work_email, a.mobile
         FROM hrms_employees e
         LEFT JOIN admins a ON a.id = e.admin_id AND a.deleted_at IS NULL
        WHERE e.id = ?`,
      [employeeId],
    );

    const row = rows[0];
    if (!row) return null;
    return {
      email: row.work_email && row.work_email.length > 0 ? row.work_email : null,
      mobile: row.mobile && row.mobile.length > 0 ? row.mobile : null,
    };
  }

  /**
   * The single column HRMS ever writes in `admins`. Keeping the password there
   * means one identity and one offboarding switch across both systems.
   */
  async updateAdminPassword(adminId: number, passwordHash: string): Promise<void> {
    await this.pool.execute(`UPDATE admins SET password = ? WHERE id = ?`, [passwordHash, adminId]);
  }

  async createOtp(input: CreateOtpInput): Promise<void> {
    await this.pool.execute(
      `INSERT INTO hrms_login_otps
         (challenge_token, employee_id, purpose, code_hash, max_attempts, sent_to, expires_at, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.challengeToken,
        input.employeeId,
        input.purpose,
        input.codeHash,
        input.maxAttempts,
        input.sentTo,
        input.expiresAt,
        input.ipAddress,
      ],
    );
  }

  async findOtpByChallenge(challengeToken: string): Promise<StoredOtp | null> {
    const [rows] = await this.pool.execute<OtpRow[]>(
      `SELECT id, employee_id, purpose, code_hash, attempts, max_attempts,
              (expires_at <= NOW())      AS is_expired,
              (consumed_at IS NOT NULL)  AS is_consumed
         FROM hrms_login_otps
        WHERE challenge_token = ?`,
      [challengeToken],
    );

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      employeeId: row.employee_id,
      purpose: row.purpose,
      codeHash: row.code_hash,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      expired: row.is_expired === 1,
      consumed: row.is_consumed === 1,
    };
  }

  async incrementOtpAttempts(otpId: number): Promise<number> {
    await this.pool.execute(
      `UPDATE hrms_login_otps SET attempts = attempts + 1 WHERE id = ?`,
      [otpId],
    );
    const [rows] = await this.pool.execute<ScalarRow[]>(
      `SELECT attempts AS value FROM hrms_login_otps WHERE id = ?`,
      [otpId],
    );
    return Number(rows[0]?.value ?? 0);
  }

  async consumeOtp(otpId: number): Promise<void> {
    await this.pool.execute(
      `UPDATE hrms_login_otps SET consumed_at = NOW() WHERE id = ? AND consumed_at IS NULL`,
      [otpId],
    );
  }

  async consumeOpenOtps(employeeId: number, purpose: OtpPurpose): Promise<void> {
    await this.pool.execute(
      `UPDATE hrms_login_otps SET consumed_at = NOW()
        WHERE employee_id = ? AND purpose = ? AND consumed_at IS NULL`,
      [employeeId, purpose],
    );
  }

  async secondsSinceLastOtp(employeeId: number, purpose: OtpPurpose): Promise<number> {
    const [rows] = await this.pool.execute<ScalarRow[]>(
      `SELECT TIMESTAMPDIFF(SECOND, MAX(created_at), NOW()) AS value
         FROM hrms_login_otps
        WHERE employee_id = ? AND purpose = ?`,
      [employeeId, purpose],
    );
    const value = rows[0]?.value;
    // No prior code at all means the cooldown cannot be active.
    return value === null || value === undefined ? Number.MAX_SAFE_INTEGER : Number(value);
  }

  async findTierInputs(employeeId: number): Promise<TierInputs | null> {
    const [rows] = await this.pool.execute<TierRow[]>(
      `SELECT e.hrms_role,
              e.is_manager_override,
              EXISTS (
                SELECT 1 FROM hrms_employees r
                 WHERE r.manager_id = e.id
                   AND (r.date_of_leaving IS NULL OR r.date_of_leaving >= CURDATE())
              ) AS has_active_reports
         FROM hrms_employees e
        WHERE e.id = ?`,
      [employeeId],
    );

    const row = rows[0];
    if (!row) return null;

    return {
      hrmsRole: row.hrms_role,
      isManagerOverride: row.is_manager_override === 1,
      hasActiveReports: row.has_active_reports === 1,
    };
  }

  async findEmployeeProfile(
    employeeId: number,
  ): Promise<Omit<AuthenticatedEmployee, 'tiers' | 'defaultTier'> | null> {
    const [rows] = await this.pool.execute<ProfileRow[]>(
      `SELECT id, employee_code, full_name, work_email, department, designation, date_of_joining
         FROM hrms_employees
        WHERE id = ?`,
      [employeeId],
    );

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      employeeCode: row.employee_code,
      fullName: row.full_name,
      workEmail: row.work_email,
      department: row.department,
      designation: row.designation,
      dateOfJoining: row.date_of_joining,
    };
  }

  async createSession(
    employeeId: number,
    refreshTokenHash: string,
    expiresAt: Date,
    context: SessionContext,
  ): Promise<number> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO hrms_sessions (employee_id, refresh_token_hash, expires_at, user_agent, ip_address)
       VALUES (?, ?, ?, ?, ?)`,
      [employeeId, refreshTokenHash, expiresAt, context.userAgent, context.ipAddress],
    );
    return result.insertId;
  }

  async findActiveSessionByHash(
    refreshTokenHash: string,
  ): Promise<{ id: number; employeeId: number } | null> {
    const [rows] = await this.pool.execute<SessionRow[]>(
      `SELECT id, employee_id
         FROM hrms_sessions
        WHERE refresh_token_hash = ?
          AND revoked_at IS NULL
          AND expires_at > NOW()`,
      [refreshTokenHash],
    );

    const row = rows[0];
    return row ? { id: row.id, employeeId: row.employee_id } : null;
  }

  async revokeSession(sessionId: number, reason: string): Promise<void> {
    await this.pool.execute(
      `UPDATE hrms_sessions SET revoked_at = NOW(), revoked_reason = ? WHERE id = ? AND revoked_at IS NULL`,
      [reason, sessionId],
    );
  }

  async revokeAllSessionsForEmployee(employeeId: number, reason: string): Promise<void> {
    await this.pool.execute(
      `UPDATE hrms_sessions SET revoked_at = NOW(), revoked_reason = ?
        WHERE employee_id = ? AND revoked_at IS NULL`,
      [reason, employeeId],
    );
  }

  async recordAudit(
    actorEmployeeId: number | null,
    action: string,
    entityType: string,
    entityId: number | null,
    context: SessionContext,
  ): Promise<void> {
    await this.pool.execute(
      `INSERT INTO hrms_audit_log (actor_employee_id, action, entity_type, entity_id, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [actorEmployeeId, action, entityType, entityId, context.ipAddress, context.userAgent],
    );
  }
}
