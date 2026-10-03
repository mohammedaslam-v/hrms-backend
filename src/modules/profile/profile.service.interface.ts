import { DismissEmployeeDto, DocumentFileResult, DocumentKey, ProfileDocument, ProfileView, SaveDocumentDto, ToggleSalaryDto, UpdateCompensationDto, CompensationView, UpdatePersonalDetailsDto } from './profile.model';

export interface IProfileService {
  getProfile(viewerId: number, subjectId: number): Promise<ProfileView>;

  saveDocument(
    viewerId: number,
    subjectId: number,
    dto: SaveDocumentDto,
  ): Promise<ProfileDocument>;

  getDocumentFile(
    viewerId: number,
    subjectId: number,
    key: DocumentKey,
  ): Promise<DocumentFileResult>;

  deleteDocument(
    viewerId: number,
    subjectId: number,
    key: DocumentKey,
  ): Promise<void>;

  toggleLogin(
    viewerId: number,
    subjectId: number,
    disabled: boolean,
  ): Promise<{ isLoginDisabled: boolean }>;

  dismissEmployee(
    viewerId: number,
    subjectId: number,
    dto: DismissEmployeeDto,
  ): Promise<void>;

  toggleSalary(
    viewerId: number,
    subjectId: number,
    dto: ToggleSalaryDto,
  ): Promise<{ isSalaryStopped: boolean }>;

  updateEmploymentType(
    viewerId: number,
    subjectId: number,
    employmentType: string,
  ): Promise<{ employmentType: string; isContractor: boolean }>;

  updateWorkMode(
    viewerId: number,
    subjectId: number,
    workMode: string,
  ): Promise<{ workMode: string }>;

  updatePersonalDetails(
    viewerId: number,
    subjectId: number,
    dto: UpdatePersonalDetailsDto,
  ): Promise<ProfileView>;

  deleteEmployee(
    viewerId: number,
    subjectId: number,
  ): Promise<void>;
  updateCompensation(
    viewerId: number,
    subjectId: number,
    dto: UpdateCompensationDto,
  ): Promise<CompensationView>;
}
