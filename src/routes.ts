import { Router } from 'express';
import { Container } from './container';
import { createAttendanceRouter } from './modules/attendance/attendance.routes';
import { createFeedbackRouter } from './modules/feedback/feedback.routes';
import { createProjectsRouter } from './modules/projects/projects.routes';
import { createTeamRouter } from './modules/team/team.routes';
import { createAuthRouter } from './modules/auth/auth.routes';
import { createEmployeeRouter } from './modules/employees/employee.routes';
import { createLeaveRouter } from './modules/leave/leave.routes';
import { createProfileRouter } from './modules/profile/profile.routes';
import { createGoalsRouter } from './modules/goals/goals.routes';
import { createSalaryRouter } from './modules/salary/salary.routes';
import { createReimbursementRouter } from './modules/reimbursement/reimbursement.routes';
import { createTaxRouter } from './modules/tax/tax.routes';

export const createApiRouter = (container: Container): Router => {
  const router = Router();

  router.use('/auth', createAuthRouter(container.authController));
  router.use('/leave', createLeaveRouter(container.leaveController));
  router.use('/employees', createEmployeeRouter(container.employeeController));
  router.use('/profile', createProfileRouter(container.profileController));
  router.use('/attendance', createAttendanceRouter(container.attendanceController));
  router.use('/team', createTeamRouter(container.teamController));
  router.use('/projects', createProjectsRouter(container.projectsController));
  router.use('/feedback', createFeedbackRouter(container.feedbackController));
  router.use('/goals', createGoalsRouter(container.goalsController));
  router.use('/salary', createSalaryRouter(container.salaryController));
  router.use('/reimbursements', createReimbursementRouter(container.reimbursementController));
  router.use('/tax', createTaxRouter(container.taxController));

  return router;
};
