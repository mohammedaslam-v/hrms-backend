import { DocumentKey, ProfileDocument, ProfileView, SaveDocumentDto } from './profile.model';

export interface IProfileService {
  /**
   * The complete profile, gated to what this viewer may see.
   */
  getProfile(viewerId: number, subjectId: number): Promise<ProfileView>;

  /**
   * Upload or update an employee's onboarding/identity document.
   */
  saveDocument(
    viewerId: number,
    subjectId: number,
    dto: SaveDocumentDto,
  ): Promise<ProfileDocument>;

  /**
   * Resolve physical path on disk for document download.
   */
  getDocumentFilePath(
    viewerId: number,
    subjectId: number,
    key: DocumentKey,
  ): Promise<string>;
}
