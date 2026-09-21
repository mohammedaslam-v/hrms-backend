import { DismissEmployeeDto, DocumentKey, ProfileDocument, ProfileView, SaveDocumentDto, ToggleSalaryDto } from './profile.model';

export interface IProfileService {
  getProfile(viewerId: number, subjectId: number): Promise<ProfileView>;

  saveDocument(
    viewerId: number,
    subjectId: number,
    dto: SaveDocumentDto,
  ): Promise<ProfileDocument>;

  getDocumentFilePath(
    viewerId: number,
    subjectId: number,
    key: DocumentKey,
  ): Promise<string>;

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

  deleteEmployee(
    viewerId: number,
    subjectId: number,
  ): Promise<void>;
}
