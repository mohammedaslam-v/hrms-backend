import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { IEmployeeRepository } from '../interfaces/repositories/employee.repository.interface';
import {
  CreateEmployeeDto,
  Employee,
  EmployeeStatus,
  UpdateEmployeeDto,
} from '../models/employee.model';

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

// Whitelist of updatable columns — column names never come from user input
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
