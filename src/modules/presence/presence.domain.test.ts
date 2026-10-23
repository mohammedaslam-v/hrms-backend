import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ONLINE_WINDOW_SECONDS, pageNameFor, statusOf, summarise } from './presence.domain';
import { PresenceRow } from './presence.model';
import { PresenceService } from './presence.service';
import { IPresenceRepository } from './presence.repository.interface';
import { IAuthService } from '../auth/auth.service.interface';
import { IOrgRepository } from '../org/org.repository.interface';
import { IAccessService } from '../access/access.service.interface';
import { AccessTier } from '../auth/auth.model';

const row = (over: Partial<PresenceRow> = {}): PresenceRow => ({
  admin_id: 1,
  name: 'Asha',
  role: 'SSM',
  last_path: '/tickets',
  seconds_ago: 30,
  session_minutes: 12,
  signed_off: 0,
  ...over,
});

// ── The admin panel's rules ───────────────────────────────────────────────────

test('online for three minutes after the last ping, away after that', () => {
  assert.equal(statusOf(row({ seconds_ago: ONLINE_WINDOW_SECONDS })), 'online');
  assert.equal(statusOf(row({ seconds_ago: ONLINE_WINDOW_SECONDS + 1 })), 'away');
});

test('a logout wins over a recent ping', () => {
  assert.equal(statusOf(row({ seconds_ago: 5, signed_off: 1 })), 'signed_off');
});

test('page names use the longest matching prefix', () => {
  assert.equal(pageNameFor('/tickets'), 'All Tickets');
  assert.equal(pageNameFor('/tickets/create'), 'Create Ticket');
  assert.equal(pageNameFor('/tickets/show/42'), 'Ticket');
  assert.equal(pageNameFor('/price-packages/12'), 'Price Packages');
  assert.equal(pageNameFor('/ticketsx'), null);
  assert.equal(pageNameFor('/somewhere-new'), null);
  assert.equal(pageNameFor(null), null);
});

test('summary splits online from recent and counts both', () => {
  const s = summarise([
    row({ admin_id: 1 }),
    row({ admin_id: 2, seconds_ago: 900 }),
    row({ admin_id: 3, signed_off: 1 }),
  ]);
  assert.deepEqual(s.online.map((p) => p.admin_id), [1]);
  assert.deepEqual(s.recent.map((p) => p.admin_id), [2, 3]);
  assert.deepEqual(s.counts, { online: 1, last_hour: 3 });
  assert.equal(s.online[0].page.name, 'All Tickets');
});

// ── Who sees whom ─────────────────────────────────────────────────────────────

function serviceFor(tiers: AccessTier[], team: number[] = []) {
  const asked: { adminIds?: number[] | null } = {};
  const repo: IPresenceRepository = {
    async findRecent(_within, adminIds) {
      asked.adminIds = adminIds;
      return [];
    },
    async findDays() {
      return [];
    },
    async findAdminIdMap() {
      return new Map();
    },
    async findLatestForMany() {
      return new Map();
    },
    async findUnlinkedSeen() {
      return [];
    },
    async countOnline() {
      return 0;
    },
    async findAdminRoles() {
      return new Map();
    },
    async findDaysForMany() {
      return new Map();
    },
    async findLatest() {
      return {
        last_path: '/tickets/show/9',
        seconds_ago: 400,
        session_minutes: 50,
        signed_off: 0,
        last_seen_ist: '2026-10-16 18:40',
      };
    },
    async findAdminIdsFor(employeeIds) {
      // Employee 5 is linked to admin 327.
      return employeeIds.map((id) => (id === 5 ? 327 : id + 1000));
    },
  };
  const auth = {
    async getCurrentEmployee(id: number) {
      return { id, tiers } as never;
    },
  } as unknown as IAuthService;
  const org = {
    async findReportingTree() {
      return team.map((id) => ({ id, employeeCode: '', fullName: '', designation: null }));
    },
  } as unknown as IOrgRepository;
  const access = {
    async require() {
      return 'self';
    },
  } as unknown as IAccessService;
  return { service: new PresenceService(repo, auth, org, access, {} as never), asked };
}

test('an admin sees everyone, people without an HRMS record included', async () => {
  const { service, asked } = serviceFor(['employee', 'manager', 'admin'], [7]);
  const s = await service.getOnline(5);
  assert.equal(asked.adminIds, null);
  assert.deepEqual(s.viewer_admin_ids, [327]);
});

test('a manager sees everyone too — the list is company-wide', async () => {
  const { service, asked } = serviceFor(['employee', 'manager'], [7, 8]);
  await service.getOnline(5);
  assert.equal(asked.adminIds, null);
});

test('an employee sees everyone too, and is still marked as themselves', async () => {
  const { service, asked } = serviceFor(['employee'], [7]);
  const s = await service.getOnline(5);
  assert.equal(asked.adminIds, null);
  assert.deepEqual(s.viewer_admin_ids, [327]);
});


test('admin activity: last seen splits into India date and time, status as the list', async () => {
  const { service } = serviceFor(['employee']);
  const a = await service.getAdminActivity(5, 5, '2026-10-12', '2026-10-18');
  assert.equal(a.linked, true);
  assert.deepEqual(a.now, {
    status: 'away',
    secondsAgo: 400,
    sessionMinutes: 50,
    page: { path: '/tickets/show/9', name: 'Ticket' },
    lastSeenDate: '2026-10-16',
    lastSeenTime: '18:40',
  });
});

test('admin activity: refuses bad or overlong ranges', async () => {
  const { service } = serviceFor(['employee']);
  const status = (err: { statusCode?: number }) => err.statusCode === 400;
  await assert.rejects(service.getAdminActivity(5, 5, '2026-10-18', '2026-10-12'), status);
  await assert.rejects(service.getAdminActivity(5, 5, 'yesterday', '2026-10-12'), status);
  await assert.rejects(service.getAdminActivity(5, 5, '2026-09-01', '2026-10-12'), status);
});


test('there is no allow-list — any signed-in person gets the whole company', async () => {
  const { service, asked } = serviceFor(['employee']);
  await service.getOnline(6);
  assert.equal(asked.adminIds, null);
});
