export type PolicyStatus = 'active' | 'draft' | 'archived';

export interface CompanyPolicy {
  id: number;
  title: string;
  description: string;
  status: PolicyStatus;
  category: string;
  createdBy: number | null;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePolicyPayload {
  title: string;
  description: string;
  status?: PolicyStatus;
  category?: string;
}

export interface UpdatePolicyPayload {
  title?: string;
  description?: string;
  status?: PolicyStatus;
  category?: string;
}

export interface PolicyFilter {
  search?: string;
  status?: string;
  category?: string;
}
