import { getPool } from './config/database';
import { AuthController } from './controllers/auth.controller';
import { LeaveController } from './controllers/leave.controller';
import { ProfileController } from './controllers/profile.controller';
import { EmployeeController } from './controllers/employee.controller';
import { IAuthRepository } from './interfaces/repositories/auth.repository.interface';
import { ILeaveRepository } from './interfaces/repositories/leave.repository.interface';
import { IProfileRepository } from './interfaces/repositories/profile.repository.interface';
import { IEmployeeRepository } from './interfaces/repositories/employee.repository.interface';
import { IAuthService } from './interfaces/services/auth.service.interface';
import { IEmployeeService } from './interfaces/services/employee.service.interface';
import { ILeaveService } from './interfaces/services/leave.service.interface';
import { IProfileService } from './interfaces/services/profile.service.interface';
import { IOtpService } from './interfaces/services/otp.service.interface';
import { AuthRepository } from './repositories/auth.repository';
import { LeaveRepository } from './repositories/leave.repository';
import { ProfileRepository } from './repositories/profile.repository';
import { EmployeeRepository } from './repositories/employee.repository';
import { AuthService } from './services/auth.service';
import { LeaveService } from './services/leave.service';
import { ProfileService } from './services/profile.service';
import { OtpService } from './services/otp.service';
import { EmployeeService } from './services/employee.service';

// Composition root: the only place where concrete implementations are chosen.
// Every layer depends on interfaces, wired here via constructor injection.
export const createContainer = () => {
  const pool = getPool();

  const authRepository: IAuthRepository = new AuthRepository(pool);
  const otpService: IOtpService = new OtpService(authRepository);
  const authService: IAuthService = new AuthService(authRepository, otpService);
  const authController = new AuthController(authService);

  const leaveRepository: ILeaveRepository = new LeaveRepository(pool);
  const leaveService: ILeaveService = new LeaveService(leaveRepository);
  const leaveController = new LeaveController(leaveService, authService);

  // My page reads its own record but borrows the leave balance, so the profile
  // service depends on the leave service rather than re-deriving the number.
  const profileRepository: IProfileRepository = new ProfileRepository(pool);
  const profileService: IProfileService = new ProfileService(
    profileRepository,
    authService,
    leaveService,
  );
  const profileController = new ProfileController(profileService);

  const employeeRepository: IEmployeeRepository = new EmployeeRepository(pool);
  const employeeService: IEmployeeService = new EmployeeService(employeeRepository);
  const employeeController = new EmployeeController(employeeService);

  return { authController, leaveController, profileController, employeeController };
};

export type Container = ReturnType<typeof createContainer>;
