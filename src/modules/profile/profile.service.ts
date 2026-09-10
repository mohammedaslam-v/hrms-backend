import { canSeeCompensation, canSeePersonalDetails } from '../access/access.domain';
import { vestedUnits } from '../compensation/compensation.domain';
import { ICompensationService } from '../compensation/compensation.service.interface';
import { FeedbackRecord } from '../feedback/feedback.model';
import { IFeedbackService } from '../feedback/feedback.service.interface';
import { GoalView } from '../goals/goals.model';
import { ProjectRecord } from '../projects/projects.model';
import { IProjectsService } from '../projects/projects.service.interface';
import { IGoalsService } from '../goals/goals.service.interface';
import { IProfileRepository } from './profile.repository.interface';
import { IAccessService } from '../access/access.service.interface';
import { ILeaveService } from '../leave/leave.service.interface';
import { IProfileService } from './profile.service.interface';
import { CompensationView, ProfileRecord, ProfileView } from './profile.model';
import { ApiError } from '../../utils/api-error';

const toCompensationView = (
  record: NonNullable<Awaited<ReturnType<ICompensationService['getCurrent']>>>,
): CompensationView => ({
  effectiveFrom: record.effectiveFrom,
  ctc: record.ctc,
  variablePay: record.variablePay,
  bonus: record.bonus,
  esopUnits: record.esopUnits,
  esopVestedPct: record.esopVestedPct,
  esopVestedUnits: vestedUnits(record),
  revisionNote: record.revisionNote,
});

export class ProfileService implements IProfileService {
  constructor(
    private readonly profileRepository: IProfileRepository,
    private readonly accessService: IAccessService,
    private readonly leaveService: ILeaveService,
    private readonly compensationService: ICompensationService,
    private readonly goalsService: IGoalsService,
    private readonly projectsService: IProjectsService,
    private readonly feedbackService: IFeedbackService,
  ) {}

  async getProfile(viewerId: number, subjectId: number): Promise<ProfileView> {
    const record = await this.profileRepository.findProfile(subjectId);
    if (!record) {
      throw ApiError.notFound('That employee record does not exist.');
    }

    const access = await this.accessService.require(viewerId, subjectId);

    // Only ask for pay when this viewer could actually be shown it. A manager
    // opening a report must not cause the figures to be read at all, let alone
    // serialised — the cheapest way to keep a secret is not to fetch it.
    const [leaveBalance, compensation, goals, projects, feedback] = await Promise.all([
      this.leaveBalanceOf(subjectId),
      canSeeCompensation(access) ? this.compensationService.getCurrent(subjectId) : null,
      this.goalsService.getForEmployee(subjectId),
      this.projectsService.getForEmployee(subjectId),
      // The access level goes in, so restricted notes are dropped before they
      // are ever serialised.
      this.feedbackService.getVisibleTo(subjectId, access),
    ]);

    return this.toView(record, access, leaveBalance, compensation, goals, projects, feedback);
  }

  /**
   * The balance comes from the leave engine, which derives it month by month
   * from the accrual rule and the approved requests. Querying it here would be a
   * second implementation of the same number, and the two would disagree the
   * first time someone took leave beyond their balance.
   */
  private async leaveBalanceOf(employeeId: number): Promise<number> {
    const leave = await this.leaveService.getMyLeave(employeeId);
    return leave.ledger.balance;
  }

  private toView(
    record: ProfileRecord,
    access: 'self' | 'manager' | 'admin',
    leaveBalance: number,
    compensation: Awaited<ReturnType<ICompensationService['getCurrent']>>,
    goals: GoalView[],
    projects: ProjectRecord[],
    feedback: FeedbackRecord[],
  ): ProfileView {
    // A manager opening a report's profile gets the work-facing record — the
    // Personal details card as the design draws it. Date of birth, personal
    // email, emergency contact and the onboarding documents are a different
    // matter: they are identity data the job does not require, so they are
    // omitted from the response rather than hidden in the browser.
    const personal = canSeePersonalDetails(access);

    return {
      access,
      isSelf: access === 'self',

      employeeId: record.employeeId,
      employeeCode: record.employeeCode,
      fullName: record.fullName,
      workEmail: record.workEmail,
      designation: record.designation,
      department: record.department,
      workMode: record.workMode,
      workState: record.workState,
      shiftStart: record.shiftStart,
      shiftEnd: record.shiftEnd,
      weeklyOff: record.weeklyOff,
      dateOfJoining: record.dateOfJoining,
      dateOfLeaving: record.dateOfLeaving,
      managerName: record.managerName,

      // Work contact — on the card in the design, so a manager sees it.
      mobile: record.mobile,

      personalEmail: personal ? record.personalEmail : null,
      dateOfBirth: personal ? record.dateOfBirth : null,
      emergencyMobile: personal ? record.emergencyMobile : null,
      city: personal ? record.city : null,
      linkedinProfile: personal ? record.linkedinProfile : null,
      documents: personal ? record.documents : [],
      leaveBalance,

      // Pay is between the employee, HR and the founder. The fields are absent
      // from the response for anyone else — hiding the card in React would be a
      // convenience for the reader, not access control.
      canSeeCompensation: canSeeCompensation(access),
      compensation: compensation ? toCompensationView(compensation) : null,
      goals,
      projects,
      feedback,
    };
  }
}
