import {
  CompanyPolicy,
  CreatePolicyPayload,
  PolicyFilter,
  UpdatePolicyPayload,
} from './company-policy.model';

export interface ICompanyPolicyRepository {
  findAll(filter?: PolicyFilter): Promise<CompanyPolicy[]>;
  findById(id: number): Promise<CompanyPolicy | null>;
  create(payload: CreatePolicyPayload & { createdBy: number | null }): Promise<CompanyPolicy>;
  update(id: number, payload: UpdatePolicyPayload): Promise<CompanyPolicy | null>;
  delete(id: number): Promise<boolean>;
}
