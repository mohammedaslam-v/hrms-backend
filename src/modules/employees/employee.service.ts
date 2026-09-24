import { IEmployeeRepository } from './employee.repository.interface';
import { IEmployeeService } from './employee.service.interface';
import {
  CreateEmployeeDto,
  CreateEmployeeRequestDto,
  CreateEmployeeResult,
  Employee,
  EmployeeMetaDto,
  UpdateEmployeeDto,
} from './employee.model';
import { IAuthService } from '../auth/auth.service.interface';
import { ApiError } from '../../utils/api-error';

export class EmployeeService implements IEmployeeService {
  constructor(
    private readonly employeeRepository: IEmployeeRepository,
    private readonly authService: IAuthService,
  ) {}

  async getMeta(): Promise<EmployeeMetaDto> {
    return this.employeeRepository.getMeta();
  }

  async createEmployeeFromForm(
    creatorId: number,
    data: CreateEmployeeRequestDto,
  ): Promise<CreateEmployeeResult> {
    const creator = await this.authService.getCurrentEmployee(creatorId);
    if (!creator.tiers.includes('admin')) {
      throw new ApiError(403, 'Only administrators can add new employees.');
    }

    if (!data.fullName || data.fullName.trim() === '') {
      throw ApiError.badRequest('Full name is required.');
    }
    if (!data.workEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.workEmail.trim())) {
      throw ApiError.badRequest('Valid work email address is required.');
    }
    if (!data.dateOfJoining) {
      throw ApiError.badRequest('Date of joining is required.');
    }
    if (!data.ctc || Number(data.ctc) <= 0) {
      throw ApiError.badRequest('Annual CTC must be a positive number.');
    }
    if (data.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i.test(data.pan.trim())) {
      throw ApiError.badRequest('PAN must be in standard 10-character alphanumeric format (e.g. ABCDE1234F).');
    }

    return this.employeeRepository.createEmployeeTransaction(data, creatorId);
  }

  async getAllEmployees(): Promise<Employee[]> {
    return this.employeeRepository.findAll();
  }

  async getEmployeeById(id: number): Promise<Employee> {
    const employee = await this.employeeRepository.findById(id);
    if (!employee) {
      throw ApiError.notFound(`Employee with id ${id} not found`);
    }
    return employee;
  }

  async createEmployee(data: CreateEmployeeDto): Promise<Employee> {
    const existing = await this.employeeRepository.findByEmail(data.email);
    if (existing) {
      throw ApiError.conflict(`An employee with email ${data.email} already exists`);
    }
    return this.employeeRepository.create(data);
  }

  async updateEmployee(id: number, data: UpdateEmployeeDto): Promise<Employee> {
    await this.getEmployeeById(id);

    if (data.email) {
      const existing = await this.employeeRepository.findByEmail(data.email);
      if (existing && existing.id !== id) {
        throw ApiError.conflict(`An employee with email ${data.email} already exists`);
      }
    }

    const updated = await this.employeeRepository.update(id, data);
    if (!updated) {
      throw ApiError.notFound(`Employee with id ${id} not found`);
    }
    return updated;
  }

  async deleteEmployee(id: number): Promise<void> {
    const deleted = await this.employeeRepository.delete(id);
    if (!deleted) {
      throw ApiError.notFound(`Employee with id ${id} not found`);
    }
  }
}
