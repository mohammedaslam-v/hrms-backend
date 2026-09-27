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

    return {
      departments,
      managers,
      workStates: ['Karnataka', 'Maharashtra', 'Telangana', 'Delhi', 'Tamil Nadu'],
      workModes: ['WFH', 'WFO', 'Hybrid'],
      esopVestingOptions: ['4 yr · 1 yr cliff', '3 yr · no cliff', 'Custom'],
    };
  }

  async createEmployeeTransaction(
    dto: CreateEmployeeRequestDto,
    creatorId: number,
  ): Promise<CreateEmployeeResult> {
    const connection = await this.pool.getConnection();
    await connection.beginTransaction();

    try {
      // 1. Uniqueness check on work email and mobile
      const [existingAdmin] = await connection.query<RowDataPacket[]>(
        `SELECT id FROM admins WHERE email = ? FOR UPDATE`,
        [dto.workEmail],
      );
      if (existingAdmin.length > 0) {
        throw ApiError.conflict(`An account with email ${dto.workEmail} already exists in the system.`);
      }

      const [existingEmp] = await connection.query<RowDataPacket[]>(
        `SELECT id FROM hrms_employees WHERE work_email = ? FOR UPDATE`,
        [dto.workEmail],
      );
      if (existingEmp.length > 0) {
        throw ApiError.conflict(`An employee with work email ${dto.workEmail} already exists.`);
      }

      // 2. Hash temporary password
      const tempPassword = 'Bambinos@2026';
      const passwordHash = await bcrypt.hash(tempPassword, 10);

      // 3. Insert account into admins
      const [adminResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO admins (
          name, email, mobile, password, date_of_birth, pan, role,
          paid_booking_access, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NOW(), NOW())`,
        [
          dto.fullName,
          dto.workEmail,
          dto.phone || '0000000000',
          passwordHash,
          dto.dateOfBirth || null,
          dto.pan ? dto.pan.toUpperCase() : null,
          dto.hrmsRole === 'admin' ? 'Admin' : 'CSR',
        ],
      );
      const adminId = adminResult.insertId;

      // 4. Derive sequential employee code: BAM- + 4-digit zero-padded adminId
      const employeeCode = `BAM-${String(adminId).padStart(4, '0')}`;

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
          dto.employmentType || 'Full-time',
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
          esop_vested_pct, revision_note, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0.00, 'Initial joining offer', ?, NOW())`,
        [
          employeeId,
          dto.dateOfJoining,
          dto.ctc,
          dto.variablePay || 0,
          dto.bonus || 0,
          dto.esopUnits || 0,
          creatorId,
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
