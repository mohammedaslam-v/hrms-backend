import { DismissEmployeeDto, DocumentKey, ProfileRecord } from './profile.model';

export interface IProfileRepository {
  findProfile(employeeId: number): Promise<ProfileRecord | null>;

  updateDocument(
    employeeId: number,
    adminId: number | null,
    key: DocumentKey,
    filePath?: string | null,
    docNumber?: string | null,
    label?: string | null,
    addedBy?: number,
  ): Promise<void>;

  findDocumentPath(employeeId: number, key: DocumentKey): Promise<string | null>;

  updateLoginDisabled(employeeId: number, disabled: boolean): Promise<void>;

  dismissEmployee(employeeId: number, dto: DismissEmployeeDto): Promise<void>;

  updateSalaryStopped(employeeId: number, stopped: boolean, reason?: string | null): Promise<void>;

  updateEmploymentType(employeeId: number, employmentType: string): Promise<void>;

  deleteEmployee(employeeId: number, adminId: number | null): Promise<void>;
}
