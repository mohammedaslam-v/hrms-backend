import { ApiError } from '../../utils/api-error';
import { IAuthService } from '../auth/auth.service.interface';
import {
  CompanyPolicy,
  CreatePolicyPayload,
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
}
