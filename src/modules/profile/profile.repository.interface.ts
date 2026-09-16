import { DocumentKey, ProfileRecord } from './profile.model';

export interface IProfileRepository {
  /**
   * The whole profile in one round trip: the HRMS record, the manager's name,
   * and the personal details and onboarding documents held in `admins`.
   */
  findProfile(employeeId: number): Promise<ProfileRecord | null>;

  /**
   * Update or attach a document file path and/or document number.
   */
  updateDocument(
    employeeId: number,
    adminId: number | null,
    key: DocumentKey,
    filePath?: string | null,
    docNumber?: string | null,
  ): Promise<void>;

  /**
   * Get the stored file path for a document key.
   */
  findDocumentPath(employeeId: number, key: DocumentKey): Promise<string | null>;
}
