import { getPool } from './config/database';
import { AttendanceController } from './modules/attendance/attendance.controller';
import { AuthController } from './modules/auth/auth.controller';
import { LeaveController } from './modules/leave/leave.controller';
import { ProfileController } from './modules/profile/profile.controller';
import { EmployeeController } from './modules/employees/employee.controller';
import { IAttendanceRepository } from './modules/attendance/attendance.repository.interface';
import { IAuthRepository } from './modules/auth/auth.repository.interface';
import { ILeaveRepository } from './modules/leave/leave.repository.interface';
import { IOrgRepository } from './modules/org/org.repository.interface';
import { ICompensationRepository } from './modules/compensation/compensation.repository.interface';
import { IPolicyRepository } from './modules/policy/policy.repository.interface';
import { IProfileRepository } from './modules/profile/profile.repository.interface';
import { IEmployeeRepository } from './modules/employees/employee.repository.interface';
import { IAttendanceService } from './modules/attendance/attendance.service.interface';
import { IAuthService } from './modules/auth/auth.service.interface';
import { IEmployeeService } from './modules/employees/employee.service.interface';
import { ILeaveService } from './modules/leave/leave.service.interface';
import { ICompensationService } from './modules/compensation/compensation.service.interface';
import { IPolicyService } from './modules/policy/policy.service.interface';
import { IProfileService } from './modules/profile/profile.service.interface';
import { IOtpService } from './modules/auth/otp.service.interface';
import { AttendanceRepository } from './modules/attendance/attendance.repository';
import { AuthRepository } from './modules/auth/auth.repository';
import { LeaveRepository } from './modules/leave/leave.repository';
import { OrgRepository } from './modules/org/org.repository';
import { CompensationRepository } from './modules/compensation/compensation.repository';
import { PolicyRepository } from './modules/policy/policy.repository';
import { ProfileRepository } from './modules/profile/profile.repository';
import { EmployeeRepository } from './modules/employees/employee.repository';
import { AttendanceService } from './modules/attendance/attendance.service';
import { AuthService } from './modules/auth/auth.service';
import { LeaveService } from './modules/leave/leave.service';
import { CompensationService } from './modules/compensation/compensation.service';
import { PolicyService } from './modules/policy/policy.service';
import { ProfileService } from './modules/profile/profile.service';
import { OtpService } from './modules/auth/otp.service';
import { EmployeeService } from './modules/employees/employee.service';

// Composition root: the only place where concrete implementations are chosen.
// Every layer depends on interfaces, wired here via constructor injection.
export const createContainer = () => {
  const pool = getPool();

  const authRepository: IAuthRepository = new AuthRepository(pool);
  const otpService: IOtpService = new OtpService(authRepository);
  const authService: IAuthService = new AuthService(authRepository, otpService);
  const authController = new AuthController(authService);

  // The organisation structure. Leave approvals and profile access both depend
  // on it, and both must get the same answer.
  const orgRepository: IOrgRepository = new OrgRepository(pool);

  const leaveRepository: ILeaveRepository = new LeaveRepository(pool);
  const leaveService: ILeaveService = new LeaveService(leaveRepository, orgRepository);
  const leaveController = new LeaveController(leaveService, authService);

  // Company policy — the grace window, the goal risk tolerance, the salary
  // constants. Read from the database so HR changes a row, not a deployment.
  const policyRepository: IPolicyRepository = new PolicyRepository(pool);
  const policyService: IPolicyService = new PolicyService(policyRepository);

  // Compensation. Read by My page today and by the Salary page later, so it is
  // its own service rather than a query hidden inside the profile.
  const compensationRepository: ICompensationRepository = new CompensationRepository(pool);
  const compensationService: ICompensationService = new CompensationService(compensationRepository);

  // Attendance depends on the policy service for the grace window, so it is
  // wired after it.
  const attendanceRepository: IAttendanceRepository = new AttendanceRepository(pool);
  const attendanceService: IAttendanceService = new AttendanceService(
    attendanceRepository,
    policyService,
  );
  const attendanceController = new AttendanceController(attendanceService);

  // My page reads its own record but borrows the leave balance, so the profile
  // service depends on the leave service rather than re-deriving the number.
  const profileRepository: IProfileRepository = new ProfileRepository(pool);
  const profileService: IProfileService = new ProfileService(
    profileRepository,
    orgRepository,
    authService,
    leaveService,
    compensationService,
  );
  const profileController = new ProfileController(profileService);

  const employeeRepository: IEmployeeRepository = new EmployeeRepository(pool);
  const employeeService: IEmployeeService = new EmployeeService(employeeRepository);
  const employeeController = new EmployeeController(employeeService);

  return {
    authController,
    leaveController,
    profileController,
    employeeController,
    attendanceController,
    policyService,
    compensationService,
  };
};

export type Container = ReturnType<typeof createContainer>;
