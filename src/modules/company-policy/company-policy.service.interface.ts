import {
  CompanyPolicy,
  CreatePolicyPayload,
  PolicyAttachmentUploadResult,
  PolicyFilter,
  UpdatePolicyPayload,
} from './company-policy.model';

export interface ICompanyPolicyService {
  getAll(viewerId: number, filter?: PolicyFilter): Promise<CompanyPolicy[]>;
  getById(viewerId: number, id: number): Promise<CompanyPolicy>;
  create(viewerId: number, payload: CreatePolicyPayload): Promise<CompanyPolicy>;
  update(viewerId: number, id: number, payload: UpdatePolicyPayload): Promise<CompanyPolicy>;
  delete(viewerId: number, id: number): Promise<void>;
  uploadAttachment(
    viewerId: number,
    fileName: string,
    fileBase64: string,
  ): Promise<PolicyAttachmentUploadResult>;
  getAttachmentFile(key: string): Promise<{ buffer: Buffer; mimeType: string; filename: string }>;
}
