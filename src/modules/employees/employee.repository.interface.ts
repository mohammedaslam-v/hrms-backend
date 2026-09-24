import {
  CreateEmployeeDto,
  CreateEmployeeRequestDto,
  CreateEmployeeResult,
  Employee,
  EmployeeMetaDto,
  UpdateEmployeeDto,
} from './employee.model';

export interface IEmployeeRepository {
  getMeta(): Promise<EmployeeMetaDto>;
  createEmployeeTransaction(
    dto: CreateEmployeeRequestDto,
    creatorId: number,
  ): Promise<CreateEmployeeResult>;
  findAll(): Promise<Employee[]>;
  findById(id: number): Promise<Employee | null>;
  findByEmail(email: string): Promise<Employee | null>;
  create(data: CreateEmployeeDto): Promise<Employee>;
  update(id: number, data: UpdateEmployeeDto): Promise<Employee | null>;
  delete(id: number): Promise<boolean>;
}
