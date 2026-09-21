import fs from 'fs';
import path from 'path';
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
import {
  CompensationView,
  DismissEmployeeDto,
  DocumentKey,
  ProfileDocument,
  ProfileRecord,
  ProfileView,
  SaveDocumentDto,
  ToggleSalaryDto,
} from './profile.model';
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

const DOCUMENT_LABELS: Record<DocumentKey, string> = {
  pan: 'PAN card',
  aadhaar: 'Aadhaar card',
  resume: 'Resume',
  permanentAddress: 'Permanent address proof',
  temporaryAddress: 'Current address proof',
};

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

    const [leaveBalance, compensation, goals, projects, feedback] = await Promise.all([
      this.leaveBalanceOf(subjectId),
      canSeeCompensation(access) ? this.compensationService.getCurrent(subjectId) : null,
      this.goalsService.getForEmployee(subjectId),
      this.projectsService.getForEmployee(subjectId),
      this.feedbackService.getVisibleTo(subjectId, access),
    ]);

    return this.toView(record, access, leaveBalance, compensation, goals, projects, feedback);
  }

  async saveDocument(
    viewerId: number,
    subjectId: number,
    dto: SaveDocumentDto,
  ): Promise<ProfileDocument> {
    const access = await this.accessService.require(viewerId, subjectId);
    if (access !== 'self' && access !== 'admin') {
      throw ApiError.forbidden('Only the employee or an admin may update documents.');
    }

    const isStandard = Boolean(DOCUMENT_LABELS[dto.key as DocumentKey]);
    const label = isStandard ? DOCUMENT_LABELS[dto.key as DocumentKey] : (dto.label?.trim() || dto.key);

    if (!dto.key || (!isStandard && !dto.label?.trim() && !dto.key)) {
      throw ApiError.badRequest('A document name is required.');
    }

    const record = await this.profileRepository.findProfile(subjectId);
    if (!record) {
      throw ApiError.notFound('That employee record does not exist.');
    }

    let filePath: string | null | undefined = undefined;

    if (dto.fileBase64) {
      const matches = dto.fileBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      let buffer: Buffer;
      let ext = 'pdf';

      if (matches && matches.length === 3) {
        const mime = matches[1].toLowerCase();
        if (mime.includes('pdf')) ext = 'pdf';
        else if (mime.includes('png')) ext = 'png';
        else if (mime.includes('jpeg') || mime.includes('jpg')) ext = 'jpg';
        buffer = Buffer.from(matches[2], 'base64');
      } else {
        buffer = Buffer.from(dto.fileBase64, 'base64');
        if (dto.fileName && dto.fileName.includes('.')) {
          ext = dto.fileName.split('.').pop()!.toLowerCase();
        }
      }

      if (buffer.length > 10 * 1024 * 1024) {
        throw ApiError.badRequest('Document file must not exceed 10 MB.');
      }

      const safeExt = ['pdf', 'png', 'jpg', 'jpeg'].includes(ext) ? ext : 'pdf';
      const cleanFileName = `${subjectId}_${dto.key}_${Date.now()}.${safeExt}`;
      const uploadsDir = path.resolve(process.cwd(), 'uploads/documents');
      await fs.promises.mkdir(uploadsDir, { recursive: true });
      const fullPath = path.join(uploadsDir, cleanFileName);
      await fs.promises.writeFile(fullPath, buffer);

      filePath = `uploads/documents/${cleanFileName}`;
    }

    let docNumber = dto.docNumber ? dto.docNumber.trim() : undefined;
    if (dto.key === 'pan' && docNumber) {
      docNumber = docNumber.toUpperCase();
    }

    await this.profileRepository.updateDocument(
      subjectId,
      record.adminId,
      dto.key,
      filePath,
      docNumber,
      label,
      viewerId,
    );

    return {
      key: dto.key,
      label,
      path: filePath || '',
      docNumber: docNumber || null,
    };
  }

  async deleteDocument(
    viewerId: number,
    subjectId: number,
    key: DocumentKey,
  ): Promise<void> {
    const access = await this.accessService.require(viewerId, subjectId);
    if (access !== 'self' && access !== 'admin') {
      throw ApiError.forbidden('Only the employee or an admin may remove documents.');
    }

    if (!key) {
      throw ApiError.badRequest('A valid document key is required.');
    }

    const record = await this.profileRepository.findProfile(subjectId);
    if (!record) {
      throw ApiError.notFound('That employee record does not exist.');
    }

    try {
      const existingPath = await this.profileRepository.findDocumentPath(subjectId, key);
      if (existingPath && !existingPath.startsWith('http')) {
        const full = path.resolve(process.cwd(), existingPath);
        if (fs.existsSync(full) && full.includes('uploads/documents')) {
          await fs.promises.unlink(full).catch(() => {});
        }
      }
    } catch {}

    await this.profileRepository.updateDocument(
      subjectId,
      record.adminId,
      key,
      null,
      null,
    );
  }

  async getDocumentFilePath(
    viewerId: number,
    subjectId: number,
    key: DocumentKey,
  ): Promise<string> {
    const access = await this.accessService.require(viewerId, subjectId);
    if (!canSeePersonalDetails(access)) {
      throw ApiError.forbidden('Documents are visible to the employee and HR only.');
    }

    const relPath = await this.profileRepository.findDocumentPath(subjectId, key);
    if (!relPath) {
      throw ApiError.notFound('Document not found for this employee.');
    }

    if (relPath.startsWith('http://') || relPath.startsWith('https://')) {
      return relPath;
    }

    const candidatePaths = [
      path.resolve(process.cwd(), relPath),
      path.resolve(process.cwd(), 'uploads', path.basename(relPath)),
      path.resolve(process.cwd(), 'uploads/documents', path.basename(relPath)),
      path.resolve('/Applications/XAMPP/xamppfiles/htdocs/bambinos-admin/public', relPath),
      path.resolve('/Applications/XAMPP/xamppfiles/htdocs', relPath),
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) return p;
    }

    throw ApiError.notFound('The document file is not found on disk.');
  }

  async toggleLogin(
    viewerId: number,
    subjectId: number,
    disabled: boolean,
  ): Promise<{ isLoginDisabled: boolean }> {
    const access = await this.accessService.require(viewerId, subjectId);
    if (access !== 'admin') {
      throw ApiError.forbidden('Only administrators can enable or disable employee login.');
    }
    if (viewerId === subjectId) {
      throw ApiError.badRequest('Administrators cannot disable their own login.');
    }

    const record = await this.profileRepository.findProfile(subjectId);
    if (!record) {
      throw ApiError.notFound('That employee record does not exist.');
    }

    await this.profileRepository.updateLoginDisabled(subjectId, disabled);
    return { isLoginDisabled: disabled };
  }

  async dismissEmployee(
    viewerId: number,
    subjectId: number,
    dto: DismissEmployeeDto,
  ): Promise<void> {
    const access = await this.accessService.require(viewerId, subjectId);
    if (access !== 'admin') {
      throw ApiError.forbidden('Only administrators can dismiss employees.');
    }
    if (viewerId === subjectId) {
      throw ApiError.badRequest('Administrators cannot dismiss their own account.');
    }

    if (!dto.lastWorkingDay) {
      throw ApiError.badRequest('Last working day is required.');
    }

    const record = await this.profileRepository.findProfile(subjectId);
    if (!record) {
      throw ApiError.notFound('That employee record does not exist.');
    }

    await this.profileRepository.dismissEmployee(subjectId, dto);
  }

  async toggleSalary(
    viewerId: number,
    subjectId: number,
    dto: ToggleSalaryDto,
  ): Promise<{ isSalaryStopped: boolean }> {
    const access = await this.accessService.require(viewerId, subjectId);
    if (access !== 'admin') {
      throw ApiError.forbidden('Only administrators can stop or resume employee salary.');
    }
    if (viewerId === subjectId) {
      throw ApiError.badRequest('Administrators cannot stop their own salary.');
    }

    const record = await this.profileRepository.findProfile(subjectId);
    if (!record) {
      throw ApiError.notFound('That employee record does not exist.');
    }

    await this.profileRepository.updateSalaryStopped(subjectId, dto.stopped, dto.reason);
    return { isSalaryStopped: dto.stopped };
  }

  async updateEmploymentType(
    viewerId: number,
    subjectId: number,
    employmentType: string,
  ): Promise<{ employmentType: string; isContractor: boolean }> {
    const access = await this.accessService.require(viewerId, subjectId);
    if (access !== "admin") {
      throw ApiError.forbidden("Only administrators can update employment types.");
    }

    const record = await this.profileRepository.findProfile(subjectId);
    if (!record) {
      throw ApiError.notFound("That employee record does not exist.");
    }

    const normalized = employmentType.trim();
    await this.profileRepository.updateEmploymentType(subjectId, normalized);
    const isContractor = normalized.toLowerCase().includes("contract");
    return { employmentType: normalized, isContractor };
  }

  async deleteEmployee(
    viewerId: number,
    subjectId: number,
  ): Promise<void> {
    const access = await this.accessService.require(viewerId, subjectId);
    if (access !== 'admin') {
      throw ApiError.forbidden('Only administrators can delete employee profiles.');
    }
    if (viewerId === subjectId) {
      throw ApiError.badRequest('Administrators cannot delete their own account.');
    }

    const record = await this.profileRepository.findProfile(subjectId);
    if (!record) {
      throw ApiError.notFound('That employee record does not exist.');
    }

    await this.profileRepository.deleteEmployee(subjectId, record.adminId);
  }

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
      employmentType: record.employmentType,
      isContractor: record.isContractor,
      workMode: record.workMode,
      workState: record.workState,
      shiftStart: record.shiftStart,
      shiftEnd: record.shiftEnd,
      weeklyOff: record.weeklyOff,
      dateOfJoining: record.dateOfJoining,
      dateOfLeaving: record.dateOfLeaving,
      managerName: record.managerName,

      mobile: record.mobile,
      personalEmail: personal ? record.personalEmail : null,
      dateOfBirth: personal ? record.dateOfBirth : null,
      emergencyMobile: personal ? record.emergencyMobile : null,
      city: personal ? record.city : null,
      linkedinProfile: personal ? record.linkedinProfile : null,
      documents: personal ? record.documents : [],
      leaveBalance,

      canSeeCompensation: canSeeCompensation(access),
      compensation: compensation ? toCompensationView(compensation) : null,
      goals,
      projects,
      feedback,

      isLoginDisabled: record.isLoginDisabled,
      loginDisabledAt: record.loginDisabledAt,
      isSalaryStopped: record.isSalaryStopped,
      salaryStoppedAt: record.salaryStoppedAt,
      salaryStopReason: record.salaryStopReason,
      resignationDate: record.resignationDate,
      resignationReason: record.resignationReason,
      isNoticeServing: record.isNoticeServing,
      lastWorkingDay: record.lastWorkingDay,
      isRehireEligible: record.isRehireEligible,
      exitNotes: record.exitNotes,
      deletedAt: record.deletedAt,
    };
  }
}
