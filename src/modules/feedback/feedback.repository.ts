import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { AddFeedbackInput, FeedbackRecord, FeedbackVisibility } from './feedback.model';
import { IFeedbackRepository } from './feedback.repository.interface';

interface FeedbackRow extends RowDataPacket {
  id: number;
  employee_id: number;
  author_id: number;
  author_name: string | null;
  body: string;
  visibility: FeedbackVisibility;
  given_on: string;
}

export class FeedbackRepository implements IFeedbackRepository {
  constructor(private readonly pool: Pool) {}

  async add(input: AddFeedbackInput): Promise<FeedbackRecord> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO hrms_employee_feedback
         (employee_id, author_id, body, visibility, given_on)
       VALUES (?, ?, ?, ?, ?)`,
      [input.employeeId, input.authorId, input.body, input.visibility, input.givenOn],
    );

    const stored = (await this.findForEmployee(input.employeeId)).find(
      (f) => f.id === result.insertId,
    );
    if (!stored) throw new Error('Feedback was inserted but could not be read back');
    return stored;
  }

  async findForEmployee(employeeId: number): Promise<FeedbackRecord[]> {
    const [rows] = await this.pool.execute<FeedbackRow[]>(
      `SELECT f.id, f.employee_id, f.author_id, f.body, f.visibility, f.given_on,
              a.full_name AS author_name
         FROM hrms_employee_feedback f
         LEFT JOIN hrms_employees a ON a.id = f.author_id
        WHERE f.employee_id = ?
        ORDER BY f.given_on DESC, f.id DESC`,
      [employeeId],
    );

    return rows.map((row) => ({
      id: row.id,
      employeeId: row.employee_id,
      authorId: row.author_id,
      authorName: row.author_name,
      body: row.body,
      visibility: row.visibility,
      givenOn: row.given_on,
    }));
  }
}
