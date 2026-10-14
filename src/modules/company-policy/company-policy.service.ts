import crypto from 'crypto';
import path from 'path';
import { ApiError } from '../../utils/api-error';
import {
  contentTypeFor,
  getObject,
  objectExists,
  putObject,
} from '../../utils/object-storage';
import { IAuthService } from '../auth/auth.service.interface';
import {
  CompanyPolicy,
  CreatePolicyPayload,
  PolicyAttachmentUploadResult,
  PolicyFilter,
  UpdatePolicyPayload,
} from './company-policy.model';
import { ICompanyPolicyRepository } from './company-policy.repository.interface';
import { ICompanyPolicyService } from './company-policy.service.interface';

export class CompanyPolicyService implements ICompanyPolicyService {
  constructor(
    private readonly repository: ICompanyPolicyRepository,
    private readonly authService: IAuthService,
  ) {}

  private async isAdmin(viewerId: number): Promise<boolean> {
    const viewer = await this.authService.getCurrentEmployee(viewerId);
    return viewer.tiers.includes('admin');
  }

  private async assertAdmin(viewerId: number): Promise<void> {
    const admin = await this.isAdmin(viewerId);
    if (!admin) {
      throw ApiError.forbidden('Only administrators can manage company policies.');
    }
  }

  async getAll(viewerId: number, filter?: PolicyFilter): Promise<CompanyPolicy[]> {
    const admin = await this.isAdmin(viewerId);
    const effectiveFilter: PolicyFilter = { ...filter };

    // Regular employees can only view active published policies
    if (!admin) {
      effectiveFilter.status = 'active';
    }

    return this.repository.findAll(effectiveFilter);
  }

  async getById(viewerId: number, id: number): Promise<CompanyPolicy> {
    const policy = await this.repository.findById(id);
    if (!policy) {
      throw ApiError.notFound('Policy not found.');
    }

    const admin = await this.isAdmin(viewerId);
    if (!admin && policy.status !== 'active') {
      throw ApiError.notFound('Policy not found.');
    }

    return policy;
  }

  async create(viewerId: number, payload: CreatePolicyPayload): Promise<CompanyPolicy> {
    await this.assertAdmin(viewerId);

    const title = payload.title?.trim();
    if (!title) {
      throw ApiError.badRequest('Policy title is required.');
    }

    const description = payload.description?.trim();
    if (!description) {
      throw ApiError.badRequest('Policy description/content is required.');
    }

    const status = payload.status || 'active';
    if (!['active', 'draft', 'archived'].includes(status)) {
      throw ApiError.badRequest('Invalid policy status.');
    }

    const category = payload.category?.trim() || 'General';

    return this.repository.create({
      title,
      description,
      status,
      category,
      createdBy: viewerId,
    });
  }

  async update(
    viewerId: number,
    id: number,
    payload: UpdatePolicyPayload,
  ): Promise<CompanyPolicy> {
    await this.assertAdmin(viewerId);

    const existing = await this.repository.findById(id);
    if (!existing) {
      throw ApiError.notFound('Policy not found.');
    }

    const updates: UpdatePolicyPayload = {};

    if (payload.title !== undefined) {
      const title = payload.title.trim();
      if (!title) throw ApiError.badRequest('Policy title cannot be empty.');
      updates.title = title;
    }

    if (payload.description !== undefined) {
      const desc = payload.description.trim();
      if (!desc) throw ApiError.badRequest('Policy description cannot be empty.');
      updates.description = desc;
    }

    if (payload.status !== undefined) {
      if (!['active', 'draft', 'archived'].includes(payload.status)) {
        throw ApiError.badRequest('Invalid policy status.');
      }
      updates.status = payload.status;
    }

    if (payload.category !== undefined) {
      updates.category = payload.category.trim() || 'General';
    }

    const updated = await this.repository.update(id, updates);
    if (!updated) {
      throw ApiError.notFound('Policy not found.');
    }
    return updated;
  }

  async delete(viewerId: number, id: number): Promise<void> {
    await this.assertAdmin(viewerId);

    const existing = await this.repository.findById(id);
    if (!existing) {
      throw ApiError.notFound('Policy not found.');
    }

    const success = await this.repository.delete(id);
    if (!success) {
      throw ApiError.badRequest('Failed to delete policy.');
    }
  }

  async uploadAttachment(
    viewerId: number,
    fileName: string,
    fileBase64: string,
  ): Promise<PolicyAttachmentUploadResult> {
    await this.assertAdmin(viewerId);

    if (!fileName || !fileBase64) {
      throw ApiError.badRequest('File name and file content are required.');
    }

    let mimeType = 'application/octet-stream';
    let buffer: Buffer;
    let ext = 'bin';

    const matches = fileBase64.match(/^data:([^;]+);base64,(.+)$/);
    if (matches) {
      mimeType = matches[1];
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      buffer = Buffer.from(fileBase64, 'base64');
    }

    if (fileName.includes('.')) {
      ext = fileName.split('.').pop()!.toLowerCase();
      if (!matches) {
        mimeType = contentTypeFor(ext);
      }
    }

    // 25 MB max
    if (buffer.length > 25 * 1024 * 1024) {
      throw ApiError.badRequest('Attachment file must not exceed 25 MB.');
    }

    const safeLabel = fileName.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const nonce = crypto.randomBytes(6).toString('hex');
    const key = `hrms/policies/${Date.now()}_${nonce}_${safeLabel}`;

    await putObject(key, buffer, mimeType);

    const downloadUrl = `/api/v1/company-policies/files/${encodeURIComponent(key)}`;

    return {
      url: downloadUrl,
      key,
      fileName,
      fileSize: buffer.length,
      mimeType,
    };
  }

  async getAttachmentFile(
    key: string,
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    // Express already decodes the route param, so the key arrives decoded.
    // Only policy attachments are served here, never other bucket objects.
    if (!key || !key.startsWith('hrms/policies/') || key.includes('..')) {
      throw ApiError.badRequest('Invalid file key.');
    }

    const exists = await objectExists(key);
    if (!exists) {
      throw ApiError.notFound('Policy attachment file not found.');
    }

    const buffer = await getObject(key);
    const filename = key.split('_').slice(2).join('_') || path.basename(key);
    const ext = filename.split('.').pop()?.toLowerCase() || 'bin';
    const mimeType = contentTypeFor(ext);

    return { buffer, mimeType, filename };
  }
}
