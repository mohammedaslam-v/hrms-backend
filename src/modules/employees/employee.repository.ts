import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { IEmployeeRepository } from './employee.repository.interface';
import {
  CreateEmployeeDto,
  CreateEmployeeRequestDto,
  CreateEmployeeResult,
  Employee,
  EmployeeMetaDto,
  EmployeeStatus,
  ManagerOption,
  UpdateEmployeeDto,
} from './employee.model';
import { ApiError } from '../../utils/api-error';
import type { SalaryComponents } from '../salary/salary.domain';

/**
 * Written to `admins.mobile` when nobody supplied a phone number.
 *
 * Shared by every such row, so it can never be treated as evidence that two
 * records are the same person — see the duplicate check in
 * createEmployeeTransaction.
 */
const PLACEHOLDER_PHONE = '0000000000';

/**
 * Components from the form, checked before anything is saved.
 *
 * The form keeps them balanced, but payroll reads them straight onto payslips,
 * so a payload that does not add up to the CTC must be refused here rather than
 * discovered on someone's salary. ₹12 a year of slack covers rounding a CTC
 * that does not divide evenly by twelve.
 */
function validComponents(
  ctc: number,
  c: SalaryComponents | undefined,
): SalaryComponents | null {
  if (!c) return null;
  const money = [c.basicM, c.hraM, c.specialM, c.employerPfM, c.gratuityM, c.employeePfM];
  if (money.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
    throw ApiError.badRequest('Salary components must all be zero or more.');
  }
  if (c.professionalTaxM != null && (!Number.isFinite(c.professionalTaxM) || c.professionalTaxM < 0)) {
    throw ApiError.badRequest('Professional tax must be zero or more.');
  }
  const monthlyCtc = c.basicM + c.hraM + c.specialM + c.employerPfM + c.gratuityM;
  if (Math.abs(monthlyCtc * 12 - Number(ctc)) > 12) {
    throw ApiError.badRequest(
      `The salary components add up to ₹${(monthlyCtc * 12).toLocaleString('en-IN')} a year, ` +
        `not the CTC of ₹${Number(ctc).toLocaleString('en-IN')}.`,
    );
  }
  return c;
}

interface EmployeeRow extends RowDataPacket {
  id: number;
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  department: string | null;
  designation: string | null;
  date_of_joining: string;
  status: EmployeeStatus;
  created_at: string;
  updated_at: string;
}

const EMPLOYEE_COLUMNS = `id, employee_code, first_name, last_name, email, phone,
  department, designation, date_of_joining, status, created_at, updated_at`;

const UPDATE_COLUMN_MAP: Record<keyof UpdateEmployeeDto, string> = {
  firstName: 'first_name',
  lastName: 'last_name',
  email: 'email',
  phone: 'phone',
  department: 'department',
  designation: 'designation',
  dateOfJoining: 'date_of_joining',
  status: 'status',
};

const mapEmployeeRow = (row: EmployeeRow): Employee => ({
  id: row.id,
  employeeCode: row.employee_code,
  firstName: row.first_name,
  lastName: row.last_name,
  email: row.email,
  phone: row.phone,
  department: row.department,
  designation: row.designation,
  dateOfJoining: row.date_of_joining,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class EmployeeRepository implements IEmployeeRepository {
  constructor(private readonly pool: Pool) {}

  async getMeta(): Promise<EmployeeMetaDto> {
    const [deptRows] = await this.pool.query<RowDataPacket[]>(
      `SELECT DISTINCT department FROM hrms_employees
       WHERE department IS NOT NULL AND TRIM(department) != ''
       ORDER BY department`,
    );
    const existingDepts = deptRows.map((r) => String(r.department).trim());
    const defaultDepts = ['Leadership', 'Sales', 'Marketing', 'Curriculum', 'Tech', 'Operations', 'People', 'HR'];
    const departments = Array.from(new Set([...defaultDepts, ...existingDepts]));

    const [managerRows] = await this.pool.query<RowDataPacket[]>(
      `SELECT id, full_name, employee_code, department, designation
       FROM hrms_employees
       WHERE (date_of_leaving IS NULL OR date_of_leaving >= CURDATE())
         AND (deleted_at IS NULL)
       ORDER BY full_name`,
    );
    const managers: ManagerOption[] = managerRows.map((r) => ({
      id: Number(r.id),
      name: String(r.full_name),
      employeeCode: String(r.employee_code),
      department: r.department ? String(r.department) : null,
      designation: r.designation ? String(r.designation) : null,
    }));

    const [maxCodeRows] = await this.pool.query<RowDataPacket[]>(
      `SELECT COALESCE(MAX(CAST(employee_code AS UNSIGNED)), 0) AS max_code
       FROM hrms_employees
       WHERE employee_code REGEXP '^[0-9]+$' AND deleted_at IS NULL`,
    );
    const maxNumeric = Number(maxCodeRows[0]?.max_code || 0);
    const nextEmployeeCode = String(Math.max(762, maxNumeric + 1));

    return {
      departments,
      managers,
      workStates: ['Karnataka', 'Maharashtra', 'Telangana', 'Delhi', 'Tamil Nadu'],
      workModes: ['WFH', 'WFO', 'Hybrid'],
      esopVestingOptions: ['4 yr · 1 yr cliff', '3 yr · no cliff', 'Custom'],
      nextEmployeeCode,
    };
  }

  async createEmployeeTransaction(
    dto: CreateEmployeeRequestDto,
    creatorId: number,
  ): Promise<CreateEmployeeResult> {
    // Checked before the transaction opens: a bad payload should not take a
    // connection, lock rows, or leave anything half-written.
    const components = validComponents(dto.ctc, dto.components);

    const connection = await this.pool.getConnection();
    await connection.beginTransaction();

    try {
      // 1. Is this person already here?
      //
      // `deleted_at IS NULL` on both admin checks is deliberate. `admins` soft
      // deletes, and the Laravel portal signs in with
      // `WHERE email = ? AND deleted_at IS NULL`, so a closed row cannot
      // collide with a new one. Without the filter an account closed years ago
      // was enough to refuse a rehire, and the message pointed HR at a record
      // they could not see or reopen.
      const [byEmail] = await connection.query<RowDataPacket[]>(
        `SELECT id, name, email FROM admins
          WHERE email = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
        [dto.workEmail],
      );

      // The mobile matters as much as the email, and is the better signal: one
      // person has several addresses but usually one phone. Checking only the
      // email is how the same people were added twice under a work address and
      // a personal one — seventeen of them in a single import.
      const phone = (dto.phone ?? '').trim();
      let byPhoneRow: RowDataPacket | null = null;
      if (phone && phone !== PLACEHOLDER_PHONE) {
        const [byPhone] = await connection.query<RowDataPacket[]>(
          `SELECT id, name, email FROM admins
            WHERE mobile = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
          [phone],
        );
        byPhoneRow = byPhone[0] ?? null;
      }

      // Email and mobile pointing at two different live accounts means the
      // form describes nobody we can safely pick. Refuse rather than guess.
      if (byEmail[0] && byPhoneRow && byPhoneRow.id !== byEmail[0].id) {
        throw ApiError.conflict(
          `The email belongs to ${byEmail[0].name} but the mobile ${phone} belongs to ` +
            `${byPhoneRow.name} (${byPhoneRow.email}). Check which person this is.`,
        );
      }

      // An existing portal login is normal, not a duplicate. CSRs and SSMs are
      // onboarded in the old admin portal first and added to HRMS afterwards,
      // so a live admin with no employee record gets linked — never a second
      // admin row, which is how 164 duplicates were made on 1 October. Only an
      // admin that is already somebody's employee record is a real conflict.
      const existingAdmin = byEmail[0] ?? byPhoneRow;
      let linkAdminId: number | null = null;
      if (existingAdmin) {
        const [linked] = await connection.query<RowDataPacket[]>(
          `SELECT employee_code, full_name FROM hrms_employees
            WHERE admin_id = ? LIMIT 1 FOR UPDATE`,
          [existingAdmin.id],
        );
        if (linked[0]) {
          throw ApiError.conflict(
            `${existingAdmin.name} (${existingAdmin.email}) is already in HRMS as ` +
              `${linked[0].full_name}, ${linked[0].employee_code}.`,
          );
        }
        linkAdminId = Number(existingAdmin.id);
      }

      // hrms_employees keeps no soft delete — a leaver keeps their row with
      // date_of_leaving set — and work_email is the HRMS login, so it has to
      // stay unique whatever the person's status. A returning employee is a
      // reactivation of this record, not a second one, so say so.
      const [existingEmp] = await connection.query<RowDataPacket[]>(
        `SELECT id, full_name, date_of_leaving FROM hrms_employees
          WHERE work_email = ? FOR UPDATE`,
        [dto.workEmail],
      );
      const priorEmp = existingEmp[0];
      if (priorEmp) {
        throw ApiError.conflict(
          priorEmp.date_of_leaving
            ? `${priorEmp.full_name} already has an employee record on this work email, ` +
              `marked as having left on ${priorEmp.date_of_leaving}. Reactivate that record ` +
              `rather than creating a second one.`
            : `An employee with work email ${dto.workEmail} already exists.`,
        );
      }

      if (dto.employeeCode && dto.employeeCode.trim()) {
        const [byCode] = await connection.query<RowDataPacket[]>(
          `SELECT id, full_name FROM hrms_employees WHERE employee_code = ? LIMIT 1 FOR UPDATE`,
          [dto.employeeCode.trim().toUpperCase()],
        );
        if (byCode[0]) {
          throw ApiError.conflict(
            `Employee code ${dto.employeeCode.trim().toUpperCase()} is already assigned to ${byCode[0].full_name}.`,
          );
        }
      }

      // 2–3. A portal account: reuse the existing one, or create it.
      //
      // When linking, the admins row is not touched at all — its password,
      // role and `access` belong to the old portal, which the person is already
      // signing into. The details from this form go to hrms_employees only.
      let adminId: number;
      let tempPassword: string | null = null;
      if (linkAdminId !== null) {
        adminId = linkAdminId;
      } else {
        tempPassword = 'Bambinos@2026';
        const passwordHash = await bcrypt.hash(tempPassword, 10);
        const [adminResult] = await connection.execute<ResultSetHeader>(
          `INSERT INTO admins (
            name, email, mobile, password, date_of_birth, pan, role,
            paid_booking_access, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NOW(), NOW())`,
          [
            dto.fullName,
            dto.workEmail,
            dto.phone || PLACEHOLDER_PHONE,
            passwordHash,
            dto.dateOfBirth || null,
            dto.pan ? dto.pan.toUpperCase() : null,
            dto.hrmsRole === 'admin' ? 'Admin' : 'CSR',
          ],
        );
        adminId = adminResult.insertId;
      }

      // 4. Employee code: custom provided or derived sequential code starting at 762
      let employeeCode: string;
      if (dto.employeeCode && dto.employeeCode.trim()) {
        employeeCode = dto.employeeCode.trim().toUpperCase();
      } else {
        const [maxRows] = await connection.query<RowDataPacket[]>(
          `SELECT COALESCE(MAX(CAST(employee_code AS UNSIGNED)), 0) AS max_code
           FROM hrms_employees
           WHERE employee_code REGEXP '^[0-9]+$' AND deleted_at IS NULL
           FOR UPDATE`,
        );
        const maxNumeric = Number(maxRows[0]?.max_code || 0);
        employeeCode = String(Math.max(762, maxNumeric + 1));
      }

      // 5. Insert master profile into hrms_employees
      const weeklyOffStr = (dto.weeklyOff && dto.weeklyOff.length > 0)
        ? dto.weeklyOff.join(',')
        : 'Sun';

      const [empResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO hrms_employees (
          admin_id, employee_code, full_name, work_email, phone, manager_id,
          department, designation, employment_type, work_mode, work_state,
          shift_start, shift_end, weekly_off, date_of_joining, date_of_leaving,
          date_of_birth, pan, uan, opening_leave, hrms_role, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          adminId,
          employeeCode,
          dto.fullName,
          dto.workEmail,
          dto.phone || null,
          dto.managerId || null,
          dto.department || null,
          dto.title || 'Associate',
          dto.employmentType || 'Employee',
          dto.workMode || 'WFO',
          dto.workState || 'Karnataka',
          dto.shiftStart || '10:00:00',
          dto.shiftEnd || '19:00:00',
          weeklyOffStr,
          dto.dateOfJoining,
          dto.dateOfLeaving || null,
          dto.dateOfBirth || null,
          dto.pan ? dto.pan.toUpperCase() : null,
          dto.uan || null,
          dto.openingLeave ?? 0.0,
          dto.hrmsRole || 'employee',
        ],
      );
      const employeeId = empResult.insertId;

      // 6. Insert initial compensation record
      await connection.execute(
        `INSERT INTO hrms_employee_compensation (
          employee_id, effective_from, ctc, variable_pay, bonus, esop_units,
          esop_vested_pct, revision_note, created_by, created_at,
          basic_monthly, hra_monthly, special_monthly, employer_pf_monthly,
          gratuity_monthly, employee_pf_monthly, professional_tax_monthly
        ) VALUES (?, ?, ?, ?, ?, ?, 0.00, 'Initial joining offer', ?, NOW(), ?, ?, ?, ?, ?, ?, ?)`,
        [
          employeeId,
          dto.dateOfJoining,
          dto.ctc,
          dto.variablePay || 0,
          dto.bonus || 0,
          dto.esopUnits || 0,
          creatorId,
          components?.basicM ?? null,
          components?.hraM ?? null,
          components?.specialM ?? null,
          components?.employerPfM ?? null,
          components?.gratuityM ?? null,
          components?.employeePfM ?? null,
          components?.professionalTaxM ?? null,
        ],
      );

      await connection.commit();

      return {
        employeeId,
        adminId,
        employeeCode,
        fullName: dto.fullName,
        workEmail: dto.workEmail,
        temporaryPassword: tempPassword,
        linkedExistingAccount: linkAdminId !== null,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async findAll(): Promise<Employee[]> {
    const [rows] = await this.pool.query<EmployeeRow[]>(
      `SELECT ${EMPLOYEE_COLUMNS} FROM employees ORDER BY id`,
    );
    return rows.map(mapEmployeeRow);
  }

  async findById(id: number): Promise<Employee | null> {
    const [rows] = await this.pool.execute<EmployeeRow[]>(
      `SELECT ${EMPLOYEE_COLUMNS} FROM employees WHERE id = ?`,
      [id],
    );
    return rows[0] ? mapEmployeeRow(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<Employee | null> {
    const [rows] = await this.pool.execute<EmployeeRow[]>(
      `SELECT ${EMPLOYEE_COLUMNS} FROM employees WHERE email = ?`,
      [email],
    );
    return rows[0] ? mapEmployeeRow(rows[0]) : null;
  }

  async create(data: CreateEmployeeDto): Promise<Employee> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO employees
        (employee_code, first_name, last_name, email, phone, department, designation, date_of_joining, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.employeeCode,
        data.firstName,
        data.lastName,
        data.email,
        data.phone,
        data.department,
        data.designation,
        data.dateOfJoining,
        data.status,
      ],
    );
    const created = await this.findById(result.insertId);
    if (!created) {
      throw new Error(`Employee ${result.insertId} not found after insert`);
    }
    return created;
  }

  async update(id: number, data: UpdateEmployeeDto): Promise<Employee | null> {
    const assignments: string[] = [];
    const values: (string | number | null)[] = [];

    for (const [key, column] of Object.entries(UPDATE_COLUMN_MAP)) {
      const value = data[key as keyof UpdateEmployeeDto];
      if (value !== undefined) {
        assignments.push(`${column} = ?`);
        values.push(value);
      }
    }

    if (assignments.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    await this.pool.execute<ResultSetHeader>(
      `UPDATE employees SET ${assignments.join(', ')} WHERE id = ?`,
      values,
    );
    return this.findById(id);
  }

  async delete(id: number): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `DELETE FROM employees WHERE id = ?`,
      [id],
    );
    return result.affectedRows > 0;
  }
}
