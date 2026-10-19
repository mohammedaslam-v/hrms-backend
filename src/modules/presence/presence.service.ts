import { IAccessService } from '../access/access.service.interface';
import { IAttendanceRepository } from '../attendance/attendance.repository.interface';
import { IAuthService } from '../auth/auth.service.interface';
import { IOrgRepository } from '../org/org.repository.interface';
import { ApiError } from '../../utils/api-error';
import {
  MAX_ACTIVITY_RANGE_DAYS,
  ONLINE_WINDOW_SECONDS,
  RECENT_WINDOW_SECONDS,
  nowFrom,
  summarise,
} from './presence.domain';
import { AdminPanelActivity, AdminPanelDay, PresenceBoard, PresenceCount, PresenceSummary } from './presence.model';
import { BoardMember, buildBoard } from './presence.board';
import { IPresenceRepository } from './presence.repository.interface';
import { IPresenceService } from './presence.service.interface';

/** The admins-only "No HRMS record" group covers people seen this recently. */
const UNLINKED_WITHIN_DAYS = 30;

/**
 * The admin panel's who-is-online list, narrowed to what the viewer may see.
 *
 * The scope is decided from live tiers, as everywhere else. Presence is keyed
 * by admin account, so the HRMS scope is turned into admin ids first: the
 * reporting tree gives employees, `hrms_employees.admin_id` gives their admins.
 */
export class PresenceService implements IPresenceService {
  constructor(
    private readonly repository: IPresenceRepository,
    private readonly authService: IAuthService,
    private readonly orgRepository: IOrgRepository,
    private readonly accessService: IAccessService,
    private readonly attendanceRepository: IAttendanceRepository,
  ) {}

  /**
   * The admin accounts the viewer may see: null (everyone) for an admin, else
   * their own and — for a manager — their reporting tree's.
   */
  private async scopeAdminIds(viewerId: number): Promise<number[] | null> {
    const viewer = await this.authService.getCurrentEmployee(viewerId);
    if (viewer.tiers.includes('admin')) return null;
    const ids = [viewerId];
    if (viewer.tiers.includes('manager')) {
      const team = await this.orgRepository.findReportingTree(viewerId);
      ids.push(...team.map((m) => m.id));
    }
    return this.repository.findAdminIdsFor(ids);
  }

  async getCount(viewerId: number): Promise<PresenceCount> {
    const adminIds = await this.scopeAdminIds(viewerId);
    return { online: await this.repository.countOnline(ONLINE_WINDOW_SECONDS, adminIds) };
  }

  async getBoard(viewerId: number): Promise<PresenceBoard> {
    const viewer = await this.authService.getCurrentEmployee(viewerId);
    const isAdmin = viewer.tiers.includes('admin');
    const isManager = viewer.tiers.includes('manager');

    // Who is in scope: the company, a manager's tree plus themselves, or just
    // the viewer. The roster is the Team page's, so the two always agree.
    const members: BoardMember[] =
      isAdmin || isManager
        ? (await this.orgRepository.findRoster({ rootId: isAdmin ? null : viewerId })).map((m) => ({
            employeeId: m.id,
            name: m.fullName,
            designation: m.designation,
            department: m.department,
            shiftStart: m.shiftStart,
            shiftEnd: m.shiftEnd,
          }))
        : [];
    if (!members.some((m) => m.employeeId === viewerId)) {
      const schedule = await this.attendanceRepository.findSchedule(viewerId);
      members.push({
        employeeId: viewerId,
        name: viewer.fullName,
        designation: viewer.designation,
        department: viewer.department,
        shiftStart: schedule?.shiftStart ?? '10:00',
        shiftEnd: schedule?.shiftEnd ?? '19:00',
      });
    }

    const ids = members.map((m) => m.employeeId);
    const now = await this.attendanceRepository.now();
    const [adminOf, context, viewerAdminIds, unlinked] = await Promise.all([
      this.repository.findAdminIdMap(ids),
      this.attendanceRepository.findDayContextFor(ids, now.date),
      this.repository.findAdminIdsFor([viewerId]),
      isAdmin ? this.repository.findUnlinkedSeen(UNLINKED_WITHIN_DAYS) : Promise.resolve([]),
    ]);
    const adminIds = [...new Set(adminOf.values())];
    const [latest, roleOf] = await Promise.all([
      this.repository.findLatestForMany(adminIds),
      this.repository.findAdminRoles(adminIds),
    ]);

    const leaveOf = new Map<number, { type: string; isHalfDay: boolean }>();
    for (const [employeeId, day] of context) {
      if (day.leave) leaveOf.set(employeeId, { type: day.leave.type, isHalfDay: day.leave.isHalfDay });
    }

    return buildBoard({
      today: now.date,
      viewerId,
      viewerAdminIds,
      members,
      adminOf,
      roleOf,
      latest,
      leaveOf,
      unlinked,
    });
  }

  async getOnline(viewerId: number): Promise<PresenceSummary> {
    const viewer = await this.authService.getCurrentEmployee(viewerId);

    const myAdminIds = await this.repository.findAdminIdsFor([viewerId]);

    // Null means everyone — including admin-panel users with no HRMS record,
    // so an admin sees exactly what the admin panel's header shows.
    let adminIds: number[] | null = null;
    if (!viewer.tiers.includes('admin')) {
      adminIds = [...myAdminIds];
      if (viewer.tiers.includes('manager')) {
        const team = await this.orgRepository.findReportingTree(viewerId);
        for (const id of await this.repository.findAdminIdsFor(team.map((m) => m.id))) {
          if (!adminIds.includes(id)) adminIds.push(id);
        }
      }
    }

    // The admin panel marks "(you)" from its own session; HRMS signs in by
    // employee, so it says which admin accounts are the viewer's.
    return {
      ...summarise(await this.repository.findRecent(RECENT_WINDOW_SECONDS, adminIds)),
      viewer_admin_ids: myAdminIds,
    };
  }

  async getAdminActivity(
    viewerId: number,
    subjectId: number,
    from: string,
    to: string,
  ): Promise<AdminPanelActivity> {
    // The same rule as the week chart this sits in: self, their manager, an admin.
    await this.accessService.require(viewerId, subjectId);

    const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
    if (!isDate(from) || !isDate(to) || from > to) {
      throw new ApiError(400, 'from and to must be dates (YYYY-MM-DD), from on or before to.');
    }
    const span = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    if (span >= MAX_ACTIVITY_RANGE_DAYS) {
      throw new ApiError(400, `Ask for ${MAX_ACTIVITY_RANGE_DAYS} days or fewer at a time.`);
    }

    // `hrms_employees.admin_id` is one column, so one account at most.
    const [adminId] = await this.repository.findAdminIdsFor([subjectId]);
    if (!adminId) return { linked: false, days: [], now: null };

    const [days, latest] = await Promise.all([
      this.repository.findDays(adminId, from, to),
      this.repository.findLatest(adminId),
    ]);
    return { linked: true, days, now: latest ? nowFrom(latest) : null };
  }

  async adminPanelForReport(
    employeeIds: number[],
    from: string,
    to: string,
  ): Promise<Map<number, Map<string, AdminPanelDay>>> {
    const adminOf = await this.repository.findAdminIdMap(employeeIds);
    const days = await this.repository.findDaysForMany([...new Set(adminOf.values())], from, to);
    const result = new Map<number, Map<string, AdminPanelDay>>();
    for (const [employeeId, adminId] of adminOf) {
      result.set(employeeId, new Map((days.get(adminId) ?? []).map((d) => [d.date, d])));
    }
    return result;
  }
}
