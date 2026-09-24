import {
  CreateEmployeeDto,
  CreateEmployeeRequestDto,
  CreateEmployeeResult,
  Employee,
  EmployeeMetaDto,
  UpdateEmployeeDto,
} from './employee.model';

export interface IEmployeeService {
  getMeta(): Promise<EmployeeMetaDto>;
  createEmployeeFromForm(
    creatorId: number,
    data: CreateEmployeeRequestDto,
  ): Promise<CreateEmployeeResult>;
  getAllEmployees(): Promise<Employee[]>;
  getEmployeeById(id: number): Promise<Employee>;
  createEmployee(data: CreateEmployeeDto): Promise<Employee>;
  updateEmployee(id: number, data: UpdateEmployeeDto): Promise<Employee>;
  deleteEmployee(id: number): Promise<void>;
}
