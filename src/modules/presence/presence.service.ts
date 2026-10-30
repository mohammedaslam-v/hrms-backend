import { IAccessService } from '../access/access.service.interface';
import { IAttendanceRepository } from '../attendance/attendance.repository.interface';
import { addDays } from '../attendance/attendance.domain';
import { IAuthService } from '../auth/auth.service.interface';
import { IOrgRepository } from '../org/org.repository.interface';
import { ApiError } from '../../utils/api-error';
import {
  MAX_ACTIVITY_RANGE_DAYS,
  ONLINE_WINDOW_SECONDS,
  RECENT_WINDOW_SECONDS,
  isAllowedOrigin,
  nowFrom,
  parseTrackerPing,
  summarise,
} from './presence.domain';
import { AdminPanelActivity, AdminPanelDay, PresenceBoard, PresenceCount, PresenceSummary } from './presence.model';
import { BoardMember, buildBoard } from './presence.board';
import { IPresenceRepository } from './presence.repository.interface';
import { IPresenceService } from './presence.service.interface';

/** The "No HRMS record" group covers people seen this recently. */
const UNLINKED_WITHIN_DAYS = 30;

/** Pings from other panels: at most one write per admin per panel this often. */
const MIN_WRITE_GAP_MS = 20 * 1000;
/** How long "who is admin 327 / this email" is remembered. */
const ADMIN_CACHE_MS = 10 * 60 * 1000;

/**
 * The admin panel's who-is-online list.
 *
 * Company-wide for every signed-in person — employee, manager or admin all
 * see the same count and the same board (Sajan, 23 Oct 2026). Only the
 * per-person day detail on My Page (getAdminActivity) stays limited to self,
 * their manager and admins, because that is somebody's working record rather
 * than who is around right now.
 */
export class PresenceService implements IPresenceService {
  constructor(
    private readonly repository: IPresenceRepository,
    private readonly authService: IAuthService,
    private readonly orgRepository: IOrgRepository,
    private readonly accessService: IAccessService,
    private readonly attendanceRepository: IAttendanceRepository,
  ) {}

  // ── Pings from the other Bambinos panels (the shared tracker script) ───────

  /** admin id or email → admin id (or null), so a ping a minute is not a lookup a minute. */
  private readonly adminCache = new Map<string, { id: number | null; until: number }>();
  /** admin+panel → when its last ping was written, to shed duplicates from extra tabs. */
  private readonly lastWrite = new Map<string, number>();

  async recordPanelPing(origin: string | undefined, body: unknown): Promise<boolean> {
    if (!isAllowedOrigin(origin)) return false;
    const ping = parseTrackerPing(body, origin!);
    if (!ping) return false;

    const adminId = await this.adminFor(ping.adminId, ping.email);
    if (!adminId) return false;

    if (ping.event === 'signoff') {
      await this.repository.signOffFromPanel(adminId, ping.panel);
      return true;
    }

    // Several tabs of one panel each ping every minute; one write per 20 s per
    // page is plenty, and the daily total is unaffected (it adds the gap since
    // the last ping, whichever tab sent it). A new page is written at once.
    const key = `${adminId}:${ping.panel}:${ping.path ?? ''}`;
    const now = Date.now();
    if (now - (this.lastWrite.get(key) ?? 0) < MIN_WRITE_GAP_MS) return true;
    this.lastWrite.set(key, now);
    if (this.lastWrite.size > 5000) this.lastWrite.clear();

    await this.repository.touchFromPanel(adminId, ping.panel, ping.path, ping.title);
    return true;
  }

  private async adminFor(adminId: number | null, email: string | null): Promise<number | null> {
    const key = adminId ? `id:${adminId}` : `email:${email}`;
    const hit = this.adminCache.get(key);
    if (hit && hit.until > Date.now()) return hit.id;
    const id = await this.repository.resolveAdminId(adminId, email);
    if (this.adminCache.size > 5000) this.adminCache.clear();
    this.adminCache.set(key, { id, until: Date.now() + ADMIN_CACHE_MS });
    return id;
  }

  async getCount(_viewerId: number): Promise<PresenceCount> {
    // Null = every admin account, the same number the board shows.
    return { online: await this.repository.countOnline(ONLINE_WINDOW_SECONDS, null) };
  }

  async getBoard(viewerId: number): Promise<PresenceBoard> {
    const viewer = await this.authService.getCurrentEmployee(viewerId);
    const members = await this.companyMembers();

    // Someone outside the active roster (a leaver still signed in) still sees
    // themselves on their own board.
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

    return this.boardFor(members, viewerId, await this.repository.findAdminIdsFor([viewerId]));
  }

  async getBoardForAdmin(adminId: number): Promise<PresenceBoard> {
    // An admin-panel account may have no HRMS record at all, so "you" is
    // matched by admin account, never by employee.
    return this.boardFor(await this.companyMembers(), 0, [adminId]);
  }

  /** The whole company. The roster is the Team page's, so the two always agree. */
  private async companyMembers(): Promise<BoardMember[]> {
    return (await this.orgRepository.findRoster({ rootId: null })).map((m) => ({
      employeeId: m.id,
      name: m.fullName,
      designation: m.designation,
      department: m.department,
      shiftStart: m.shiftStart,
      shiftEnd: m.shiftEnd,
    }));
  }

  private async boardFor(
    members: BoardMember[],
    viewerId: number,
    viewerAdminIds: number[],
  ): Promise<PresenceBoard> {
    const ids = members.map((m) => m.employeeId);
    const now = await this.attendanceRepository.now();
    const [adminOf, context, schedules, unlinked] = await Promise.all([
      this.repository.findAdminIdMap(ids),
      this.attendanceRepository.findDayContextFor(ids, now.date),
      // Weekly offs, so the Active tab can leave out people not expected today.
      this.attendanceRepository.findSchedulesFor(ids),
      this.repository.findUnlinkedSeen(UNLINKED_WITHIN_DAYS),
    ]);
    const adminIds = [...new Set(adminOf.values())];
    const yesterday = addDays(now.date, -1);

    const [latest, roleOf, days] = await Promise.all([
      this.repository.findLatestForMany(adminIds),
      this.repository.findAdminRoles(adminIds),
      // Today and yesterday totals on the panel, so night shifts spanning two calendar days don't reset at midnight.
      this.repository.findDaysForMany([...adminIds, ...unlinked.map((u) => u.admin_id)], yesterday, now.date),
    ]);
    const activeSecondsOf = new Map<number, Map<string, number>>();
    for (const [adminId, list] of days) {
      const byDate = new Map<string, number>();
      for (const d of list) {
        byDate.set(d.date, d.activeSeconds);
      }
      activeSecondsOf.set(adminId, byDate);
    }

    const leaveOf = new Map<number, { type: string; isHalfDay: boolean }>();
    let holidayToday: string | null = null;
    for (const [employeeId, day] of context) {
      if (day.leave) leaveOf.set(employeeId, { type: day.leave.type, isHalfDay: day.leave.isHalfDay });
      holidayToday ??= day.holidayName;
    }
    const weeklyOffOf = new Map([...schedules].map(([id, s]) => [id, s.weeklyOff]));

    return buildBoard({
      today: now.date,
      time: now.time,
      weeklyOffOf,
      holidayToday,
      viewerId,
      viewerAdminIds,
      members,
      adminOf,
      roleOf,
      latest,
      leaveOf,
      unlinked,
      activeSecondsOf,
    });
  }

  async getOnline(viewerId: number): Promise<PresenceSummary> {
    const myAdminIds = await this.repository.findAdminIdsFor([viewerId]);

    // Null means everyone — including admin-panel users with no HRMS record,
    // so everybody sees exactly what the admin panel's header shows. The
    // admin panel marks "(you)" from its own session; HRMS signs in by
    // employee, so it says which admin accounts are the viewer's.
    return {
      ...summarise(await this.repository.findRecent(RECENT_WINDOW_SECONDS, null)),
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
