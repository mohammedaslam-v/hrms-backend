import { canSeeCompensation, canSeePersonalDetails, resolveProfileAccess } from './profile.domain';
import { vestedUnits } from '../compensation/compensation.domain';
import { ICompensationService } from '../compensation/compensation.service.interface';
import { IOrgRepository } from '../org/org.repository.interface';
import { IProfileRepository } from './profile.repository.interface';
import { IAuthService } from '../auth/auth.service.interface';
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

/**
 * Blocks the design shows that have no data behind them yet. Sent to the client
 * so the page can explain an empty card instead of rendering a blank one, and
 * kept here rather than in React so the reason stays true as each phase lands.
 */
const PENDING_BLOCKS: { block: string; reason: string }[] = [
  { block: 'week', reason: 'Attendance is shown on each person’s own page.' },
  { block: 'goals', reason: 'Goals have not been set up yet.' },
  { block: 'projects', reason: 'Projects are not being tracked yet.' },
  { block: 'feedback', reason: 'No feedback has been recorded yet.' },
];

export class ProfileService implements IProfileService {
  constructor(
    private readonly profileRepository: IProfileRepository,
    private readonly orgRepository: IOrgRepository,
    private readonly authService: IAuthService,
    private readonly leaveService: ILeaveService,
    private readonly compensationService: ICompensationService,
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
      ? await this.orgRepository.isInReportingTree(viewerId, subjectId)
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

    // Only ask for pay when this viewer could actually be shown it. A manager
    // opening a report must not cause the figures to be read at all, let alone
    // serialised — the cheapest way to keep a secret is not to fetch it.
    const [leaveBalance, compensation] = await Promise.all([
      this.leaveBalanceOf(subjectId),
      canSeeCompensation(access) ? this.compensationService.getCurrent(subjectId) : null,
    ]);

    return this.toView(record, access, leaveBalance, compensation);
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
      pending: PENDING_BLOCKS,
    };
  }
}
