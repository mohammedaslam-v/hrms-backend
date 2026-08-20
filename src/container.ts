import { getPool } from './config/database';
import { EmployeeController } from './controllers/employee.controller';
import { IEmployeeRepository } from './interfaces/repositories/employee.repository.interface';
import { IEmployeeService } from './interfaces/services/employee.service.interface';
import { EmployeeRepository } from './repositories/employee.repository';
import { EmployeeService } from './services/employee.service';

// Composition root: the only place where concrete implementations are chosen.
// Every layer depends on interfaces, wired here via constructor injection.
export const createContainer = () => {
  const pool = getPool();

  const employeeRepository: IEmployeeRepository = new EmployeeRepository(pool);
  const employeeService: IEmployeeService = new EmployeeService(employeeRepository);
  const employeeController = new EmployeeController(employeeService);

  return { employeeController };
};

export type Container = ReturnType<typeof createContainer>;
