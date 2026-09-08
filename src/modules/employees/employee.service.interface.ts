import { CreateEmployeeDto, Employee, UpdateEmployeeDto } from './employee.model';

export interface IEmployeeService {
  getAllEmployees(): Promise<Employee[]>;
  getEmployeeById(id: number): Promise<Employee>;
  createEmployee(data: CreateEmployeeDto): Promise<Employee>;
  updateEmployee(id: number, data: UpdateEmployeeDto): Promise<Employee>;
  deleteEmployee(id: number): Promise<void>;
}
