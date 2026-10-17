import { IAccessService } from '../access/access.service.interface';
import { IAttendanceRepository } from '../attendance/attendance.repository.interface';
import { ApiError } from '../../utils/api-error';
import { editableDates, validateActivity } from './work-activity.domain';
import { WorkActivity, WorkActivityRange } from './work-activity.model';
import { IWorkActivityRepository } from './work-activity.repository.interface';
import { IWorkActivityService } from './work-activity.service.interface';

/**
 * Activities an employee records themselves. They count straight away — there
 * is no approval step yet — and add to the active hours shown in the week
 * chart's hover box. They never change a day's status.
 *
 * "Now" comes from the attendance clock, so "today" and "later than now" mean
 * what they mean for check-in.
 */
export class WorkActivityService implements IWorkActivityService {
  constructor(
    private readonly repository: IWorkActivityRepository,
    private readonly accessService: IAccessService,
    private readonly attendanceRepository: IAttendanceRepository,
  ) {}

  async listFor(viewerId: number, subjectId: number, from: string, to: string): Promise<WorkActivityRange> {
    await this.accessService.require(viewerId, subjectId);
    const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
    if (!isDate(from) || !isDate(to) || from > to) {
      throw ApiError.badRequest('from and to must be dates (YYYY-MM-DD), from on or before to.');
    }
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 >= 62) {
      throw ApiError.badRequest('Ask for 62 days or fewer at a time.');
    }

    const now = await this.attendanceRepository.now();
    const canEdit = viewerId === subjectId;
    return {
      editableDates: canEdit ? editableDates(now.date) : [],
      canEdit,
      activities: await this.repository.findRange(subjectId, from, to),
    };
  }

  async create(viewerId: number, raw: Record<string, unknown>): Promise<WorkActivity> {
    const now = await this.attendanceRepository.now();
    const dto = validateActivity(raw, now);

    // Two records of the same stretch would count it twice in the hover box's
    // list, even though the total merges them. Refuse the overlap instead.
    const sameDay = await this.repository.findRange(viewerId, dto.date, dto.date);
    const clash = sameDay.find((a) => dto.startTime < a.endTime && a.startTime < dto.endTime);
    if (clash) {
      throw ApiError.badRequest(
        `This overlaps an activity already recorded from ${clash.startTime} to ${clash.endTime}.`,
      );
    }

    return this.repository.create(viewerId, dto, viewerId);
  }

  async remove(viewerId: number, activityId: number): Promise<void> {
    const activity = await this.repository.findById(activityId);
    if (!activity || activity.employeeId !== viewerId) {
      throw new ApiError(404, 'Activity not found.');
    }
    const now = await this.attendanceRepository.now();
    if (!editableDates(now.date).includes(activity.date)) {
      throw ApiError.badRequest('Activities older than two days can no longer be changed.');
    }
    await this.repository.softDelete(activityId, viewerId);
  }
}
