import { IEmployeeRepository } from './employee.repository.interface';
import { IEmployeeService } from './employee.service.interface';
import { CreateEmployeeDto, Employee, UpdateEmployeeDto } from './employee.model';
import { ApiError } from '../../utils/api-error';

export class EmployeeService implements IEmployeeService {
  constructor(private readonly employeeRepository: IEmployeeRepository) {}

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
