import { getPool } from './config/database';
import { DatabaseClock, IClock } from './shared/clock';
import { AttendanceController } from './modules/attendance/attendance.controller';
import { AuthController } from './modules/auth/auth.controller';
import { LeaveController } from './modules/leave/leave.controller';
import { ProfileController } from './modules/profile/profile.controller';
import { EmployeeController } from './modules/employees/employee.controller';
import { IAttendanceRepository } from './modules/attendance/attendance.repository.interface';
import { IAccessService } from './modules/access/access.service.interface';
import { IAuthRepository } from './modules/auth/auth.repository.interface';
import { ILeaveRepository } from './modules/leave/leave.repository.interface';
import { IOrgRepository } from './modules/org/org.repository.interface';
import { ICompensationRepository } from './modules/compensation/compensation.repository.interface';
import { IFeedbackRepository } from './modules/feedback/feedback.repository.interface';
import { IGoalsRepository } from './modules/goals/goals.repository.interface';
import { IProjectsRepository } from './modules/projects/projects.repository.interface';
import { IPolicyRepository } from './modules/policy/policy.repository.interface';
import { IProfileRepository } from './modules/profile/profile.repository.interface';
import { IEmployeeRepository } from './modules/employees/employee.repository.interface';
import { IAttendanceService } from './modules/attendance/attendance.service.interface';
import { IAuthService } from './modules/auth/auth.service.interface';
import { IEmployeeService } from './modules/employees/employee.service.interface';
import { ILeaveService } from './modules/leave/leave.service.interface';
import { ICompensationService } from './modules/compensation/compensation.service.interface';
import { IFeedbackService } from './modules/feedback/feedback.service.interface';
import { IGoalsService } from './modules/goals/goals.service.interface';
import { IProjectsService } from './modules/projects/projects.service.interface';
import { IPolicyService } from './modules/policy/policy.service.interface';
import { IProfileService } from './modules/profile/profile.service.interface';
import { IOtpService } from './modules/auth/otp.service.interface';
import { AttendanceRepository } from './modules/attendance/attendance.repository';
import { AccessService } from './modules/access/access.service';
import { AuthRepository } from './modules/auth/auth.repository';
import { LeaveRepository } from './modules/leave/leave.repository';
import { OrgRepository } from './modules/org/org.repository';
import { CompensationRepository } from './modules/compensation/compensation.repository';
import { FeedbackController } from './modules/feedback/feedback.controller';
import { FeedbackRepository } from './modules/feedback/feedback.repository';
import { GoalsRepository } from './modules/goals/goals.repository';
import { ProjectsController } from './modules/projects/projects.controller';
import { ProjectsRepository } from './modules/projects/projects.repository';
import { PolicyRepository } from './modules/policy/policy.repository';
import { ProfileRepository } from './modules/profile/profile.repository';
import { EmployeeRepository } from './modules/employees/employee.repository';
import { AttendanceService } from './modules/attendance/attendance.service';
import { AuthService } from './modules/auth/auth.service';
import { LeaveService } from './modules/leave/leave.service';
import { CompensationService } from './modules/compensation/compensation.service';
import { FeedbackService } from './modules/feedback/feedback.service';
import { GoalsService } from './modules/goals/goals.service';
import { ProjectsService } from './modules/projects/projects.service';
import { PolicyService } from './modules/policy/policy.service';
import { ProfileService } from './modules/profile/profile.service';
import { OtpService } from './modules/auth/otp.service';
import { EmployeeService } from './modules/employees/employee.service';

// Composition root: the only place where concrete implementations are chosen.
// Every layer depends on interfaces, wired here via constructor injection.
export const createContainer = () => {
  const pool = getPool();

  // What day it is, asked of the database rather than this process — the two are
  // not necessarily in the same timezone. See IClock.
  const clock: IClock = new DatabaseClock(pool);

  const authRepository: IAuthRepository = new AuthRepository(pool);
  const otpService: IOtpService = new OtpService(authRepository);
  const authService: IAuthService = new AuthService(authRepository, otpService);
  const authController = new AuthController(authService);

  // The organisation structure. Leave approvals and profile access both depend
  // on it, and both must get the same answer.
  const orgRepository: IOrgRepository = new OrgRepository(pool);

  // Who may see and who may write a record about a person — one answer, used by
  // the profile read and by every write about somebody.
  const accessService: IAccessService = new AccessService(authService, orgRepository);

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
  const compensationService: ICompensationService = new CompensationService(compensationRepository, clock);

  // Goals read the financial year's dates and the risk tolerance from policy.
  const goalsRepository: IGoalsRepository = new GoalsRepository(pool);
  const goalsService: IGoalsService = new GoalsService(goalsRepository, policyService, clock);

  // Work and notes recorded about a person. Feedback carries the one rule where
  // being the subject grants LESS access, so its filter lives in its service.
  const projectsRepository: IProjectsRepository = new ProjectsRepository(pool);
  const projectsService: IProjectsService = new ProjectsService(projectsRepository, accessService, pool);

  const feedbackRepository: IFeedbackRepository = new FeedbackRepository(pool);
  const feedbackService: IFeedbackService = new FeedbackService(
    feedbackRepository,
    accessService,
    clock,
    pool,
  );
  const projectsController = new ProjectsController(projectsService);
  const feedbackController = new FeedbackController(feedbackService);

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
    accessService,
    leaveService,
    compensationService,
    goalsService,
    projectsService,
    feedbackService,
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
    projectsController,
    feedbackController,
    policyService,
    compensationService,
    goalsService,
  };
};

export type Container = ReturnType<typeof createContainer>;
