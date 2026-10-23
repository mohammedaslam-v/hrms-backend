import { DismissEmployeeDto, DocumentKey, ProfileRecord, UpdatePersonalDetailsDto } from './profile.model';

export interface IProfileRepository {
  findProfile(employeeId: number): Promise<ProfileRecord | null>;

  findByEmployeeCode(employeeCode: string): Promise<{ id: number; fullName: string } | null>;

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

  updateWorkMode(employeeId: number, workMode: string): Promise<void>;

  updatePersonalDetails(employeeId: number, dto: UpdatePersonalDetailsDto): Promise<void>;

  /** Saves the geofence home point (null clears it) and stamps who did it, and when. */
  saveHomeLocation(
    employeeId: number,
    point: { lat: number; lng: number } | null,
    setBy: number,
  ): Promise<void>;

  /** Work mode and whether a home point is saved — one cheap row for the reminder. */
  findHomeLocationStatus(
    employeeId: number,
  ): Promise<{ workMode: string | null; saved: boolean } | null>;

  deleteEmployee(employeeId: number, adminId: number | null): Promise<void>;
}
