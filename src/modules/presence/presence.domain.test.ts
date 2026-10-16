import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ONLINE_WINDOW_SECONDS, pageNameFor, statusOf, summarise } from './presence.domain';
import { PresenceRow } from './presence.model';
import { PresenceService } from './presence.service';
import { IPresenceRepository } from './presence.repository.interface';
import { IAuthService } from '../auth/auth.service.interface';
import { IOrgRepository } from '../org/org.repository.interface';
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
    async findAdminIdsFor(employeeIds) {
      // Employee 5 is the pilot viewer, linked to admin 327.
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
  return { service: new PresenceService(repo, auth, org), asked };
}

test('an admin sees everyone, people without an HRMS record included', async () => {
  const { service, asked } = serviceFor(['employee', 'manager', 'admin'], [7]);
  const s = await service.getOnline(5);
  assert.equal(asked.adminIds, null);
  assert.deepEqual(s.viewer_admin_ids, [327]);
});

test('a manager sees themselves and their whole tree', async () => {
  const { service, asked } = serviceFor(['employee', 'manager'], [7, 8]);
  await service.getOnline(5);
  assert.deepEqual(asked.adminIds, [327, 1007, 1008]);
});

test('an employee sees only themselves', async () => {
  const { service, asked } = serviceFor(['employee'], [7]);
  await service.getOnline(5);
  assert.deepEqual(asked.adminIds, [327]);
});

test('only the pilot admins may see the list for now', async () => {
  const { service } = serviceFor(['employee', 'manager', 'admin']);
  await assert.rejects(service.getOnline(6), (err: { statusCode?: number }) => err.statusCode === 403);
});
