import { canSeePersonalDetails, resolveProfileAccess } from '../domain/profile';
import { IProfileRepository } from '../interfaces/repositories/profile.repository.interface';
import { IAuthService } from '../interfaces/services/auth.service.interface';
import { ILeaveService } from '../interfaces/services/leave.service.interface';
import { IProfileService } from '../interfaces/services/profile.service.interface';
import { ProfileRecord, ProfileView } from '../models/profile.model';
import { ApiError } from '../utils/api-error';

/**
 * Blocks the design shows that have no data behind them yet. Sent to the client
 * so the page can explain an empty card instead of rendering a blank one, and
 * kept here rather than in React so the reason stays true as each phase lands.
 */
const PENDING_BLOCKS: { block: string; reason: string }[] = [
  { block: 'today', reason: 'Attendance is not being recorded yet.' },
  { block: 'week', reason: 'Attendance is not being recorded yet.' },
  { block: 'compensation', reason: 'Salary details have not been loaded into HRMS yet.' },
  { block: 'goals', reason: 'Goals have not been set up yet.' },
  { block: 'projects', reason: 'Projects are not being tracked yet.' },
  { block: 'feedback', reason: 'No feedback has been recorded yet.' },
];

export class ProfileService implements IProfileService {
  constructor(
    private readonly profileRepository: IProfileRepository,
    private readonly authService: IAuthService,
    private readonly leaveService: ILeaveService,
  ) {}

  async getProfile(viewerId: number, subjectId: number): Promise<ProfileView> {
    const record = await this.profileRepository.findProfile(subjectId);
    if (!record) {
      throw ApiError.notFound('That employee record does not exist.');
    }

    // Tiers are resolved live, never read from the token, so an access change
    // takes effect on the next request rather than when the token expires.
    const viewer = await this.authService.getCurrentEmployee(viewerId);

    // Only ask the database about the reporting tree when the answer can still
    // change the outcome — viewing yourself, or holding admin, settles it.
    const needsTreeLookup = viewerId !== subjectId && !viewer.tiers.includes('admin');
    const isReport = needsTreeLookup
      ? await this.profileRepository.isInReportingTree(viewerId, subjectId)
      : false;

    const access = resolveProfileAccess({
      viewerId,
      subjectId,
      tiers: viewer.tiers,
      isReport,
    });

    if (access === 'denied') {
      // Deliberately the same message whether the person exists or not: a
      // different reply would let anyone map the company by trying ids.
      throw new ApiError(403, 'You do not have access to this profile.');
    }

    return this.toView(record, access, await this.leaveBalanceOf(subjectId));
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
      pending: PENDING_BLOCKS,
    };
  }
}
