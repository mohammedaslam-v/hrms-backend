import { CreateWorkActivityDto, WorkActivity } from './work-activity.model';

export interface IWorkActivityRepository {
  /** One employee's activities between two dates, inclusive; deleted ones left out. */
  findRange(employeeId: number, from: string, to: string): Promise<WorkActivity[]>;

  /** Several employees at once, for reports: employee id → their activities. */
  findRangeForMany(employeeIds: number[], from: string, to: string): Promise<Map<number, WorkActivity[]>>;

  findById(id: number): Promise<WorkActivity | null>;

  create(employeeId: number, dto: CreateWorkActivityDto, createdBy: number): Promise<WorkActivity>;

  /** Soft delete: the row stays, with `deleted_at` and who removed it. */
  softDelete(id: number, deletedBy: number): Promise<void>;
}
