import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import {
  CompanyPolicy,
  CreatePolicyPayload,
  PolicyFilter,
  PolicyStatus,
  UpdatePolicyPayload,
} from './company-policy.model';
import { ICompanyPolicyRepository } from './company-policy.repository.interface';

interface PolicyRow extends RowDataPacket {
  id: number;
  title: string;
  description: string;
  status: PolicyStatus;
  category: string;
  created_by: number | null;
  created_by_name: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const mapRow = (row: PolicyRow): CompanyPolicy => ({
  id: row.id,
  title: row.title,
  description: row.description,
  status: row.status,
  category: row.category,
  createdBy: row.created_by,
  createdByName: row.created_by_name,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
});

export class CompanyPolicyRepository implements ICompanyPolicyRepository {
  constructor(private readonly pool: Pool) {}

  async findAll(filter?: PolicyFilter): Promise<CompanyPolicy[]> {
    let sql = `
      SELECT p.id, p.title, p.description, p.status, p.category, p.created_by,
             p.created_at, p.updated_at, e.full_name AS created_by_name
        FROM hrms_company_policies p
        LEFT JOIN hrms_employees e ON e.id = p.created_by
       WHERE 1=1
    `;
    const params: any[] = [];

    if (filter?.status && filter.status !== 'all') {
      sql += ' AND p.status = ?';
      params.push(filter.status);
    }

    if (filter?.category && filter.category !== 'all') {
      sql += ' AND p.category = ?';
      params.push(filter.category);
    }

    if (filter?.search && filter.search.trim()) {
      const q = `%${filter.search.trim()}%`;
      sql += ' AND (p.title LIKE ? OR p.description LIKE ?)';
      params.push(q, q);
    }

    sql += ' ORDER BY p.updated_at DESC, p.id DESC';

    const [rows] = await this.pool.query<PolicyRow[]>(sql, params);
    return rows.map(mapRow);
  }

  async findById(id: number): Promise<CompanyPolicy | null> {
    const [rows] = await this.pool.execute<PolicyRow[]>(
      `SELECT p.id, p.title, p.description, p.status, p.category, p.created_by,
              p.created_at, p.updated_at, e.full_name AS created_by_name
         FROM hrms_company_policies p
         LEFT JOIN hrms_employees e ON e.id = p.created_by
        WHERE p.id = ?`,
      [id],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async create(payload: CreatePolicyPayload & { createdBy: number | null }): Promise<CompanyPolicy> {
    const status = payload.status || 'active';
    const category = payload.category || 'General';

    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO hrms_company_policies (title, description, status, category, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [payload.title, payload.description, status, category, payload.createdBy],
    );

    const created = await this.findById(result.insertId);
    if (!created) {
      throw new Error('Failed to retrieve policy record after creation.');
    }
    return created;
  }

  async update(id: number, payload: UpdatePolicyPayload): Promise<CompanyPolicy | null> {
    const updates: string[] = [];
    const params: any[] = [];

    if (payload.title !== undefined) {
      updates.push('title = ?');
      params.push(payload.title);
    }
    if (payload.description !== undefined) {
      updates.push('description = ?');
      params.push(payload.description);
    }
    if (payload.status !== undefined) {
      updates.push('status = ?');
      params.push(payload.status);
    }
    if (payload.category !== undefined) {
      updates.push('category = ?');
      params.push(payload.category);
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    params.push(id);
    await this.pool.query(
      `UPDATE hrms_company_policies SET ${updates.join(', ')} WHERE id = ?`,
      params,
    );

    return this.findById(id);
  }

  async delete(id: number): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `DELETE FROM hrms_company_policies WHERE id = ?`,
      [id],
    );
    return result.affectedRows > 0;
  }
}
