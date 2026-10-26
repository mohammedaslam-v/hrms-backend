import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAllowedOrigin,
  pageRefFor,
  panelFromOrigin,
  panelNameFor,
  parseTrackerPing,
} from './presence.domain';

const RENEWALS = 'https://renewals.bambinos.live';

test('only https bambinos.live sites (and localhost) may report', () => {
  assert.equal(isAllowedOrigin(RENEWALS), true);
  assert.equal(isAllowedOrigin('https://bambinos.live'), true);
  assert.equal(isAllowedOrigin('http://localhost:5173'), true);
  assert.equal(isAllowedOrigin('http://renewals.bambinos.live'), false, 'plain http');
  assert.equal(isAllowedOrigin('https://bambinos.live.evil.com'), false);
  assert.equal(isAllowedOrigin('https://evilbambinos.live'), false);
  assert.equal(isAllowedOrigin(undefined), false);
});

test('the panel is the first subdomain when the script tag does not name it', () => {
  assert.equal(panelFromOrigin(RENEWALS), 'renewals');
  assert.equal(panelFromOrigin('https://crm.bambinos.live'), 'crm');
  assert.equal(panelFromOrigin('https://bambinos.live'), 'site');
  assert.equal(panelFromOrigin('http://localhost:5173'), 'local');
});

test('panels read with friendly names; unknown ones are title-cased', () => {
  assert.equal(panelNameFor('renewals'), 'Renewal panel');
  assert.equal(panelNameFor(null), 'Admin panel');
  assert.equal(panelNameFor('teacher-ops'), 'Teacher ops panel');
});

test('a page is named by the admin catalogue there, else by the title, else by the path', () => {
  assert.equal(pageRefFor('/tickets/show/9').name, 'Ticket');
  assert.equal(pageRefFor('/x', 'renewals', 'Renewal Analysis').name, 'Renewal Analysis');
  assert.equal(pageRefFor('/renewal-analysis/42', 'renewals', null).name, 'Renewal analysis');
  assert.deepEqual(pageRefFor('/', 'crm', null), { path: '/', name: null, panel: 'crm', panelName: 'CRM' });
});

test('a report is cleaned: the query string never survives, the title is cut short', () => {
  const p = parseTrackerPing(
    { event: 'ping', adminId: 327, path: '/parents?mobile=9876543210', title: '  Parents   list ' + 'x'.repeat(200) },
    RENEWALS,
  )!;
  assert.equal(p.path, '/parents');
  assert.equal(p.panel, 'renewals');
  assert.equal(p.adminId, 327);
  assert.ok(p.title!.startsWith('Parents list'));
  assert.equal(p.title!.length, 120);
});

test('an email works in place of an admin id, lower-cased', () => {
  const p = parseTrackerPing({ event: 'ping', email: ' Aman@Example.com ', panel: 'crm' }, RENEWALS)!;
  assert.equal(p.email, 'aman@example.com');
  assert.equal(p.adminId, null);
  assert.equal(p.panel, 'crm', 'data-panel wins over the subdomain');
});

test('unusable reports are refused', () => {
  assert.equal(parseTrackerPing(null, RENEWALS), null);
  assert.equal(parseTrackerPing({ event: 'ping' }, RENEWALS), null, 'nobody to attribute it to');
  assert.equal(parseTrackerPing({ event: 'dance', adminId: 1 }, RENEWALS), null);
  assert.equal(parseTrackerPing({ event: 'ping', adminId: -4 }, RENEWALS), null);
  assert.equal(parseTrackerPing({ event: 'ping', adminId: 1, panel: 'admin' }, RENEWALS), null, 'admin reports for itself');
});

test('a bad panel name or path falls back safely', () => {
  const p = parseTrackerPing({ event: 'signoff', adminId: 5, panel: 'Bad Panel!', path: 'no-slash' }, RENEWALS)!;
  assert.equal(p.panel, 'renewals');
  assert.equal(p.path, null);
  assert.equal(p.event, 'signoff');
});
