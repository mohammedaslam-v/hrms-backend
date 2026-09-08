import { CreateEmployeeDto, Employee, UpdateEmployeeDto } from './employee.model';

export interface IEmployeeRepository {
  findAll(): Promise<Employee[]>;
  findById(id: number): Promise<Employee | null>;
  findByEmail(email: string): Promise<Employee | null>;
  create(data: CreateEmployeeDto): Promise<Employee>;
  update(id: number, data: UpdateEmployeeDto): Promise<Employee | null>;
  delete(id: number): Promise<boolean>;
}
