import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportingTreeCte, MAX_REPORTING_DEPTH } from './reporting-tree.sql';

test('reportingTreeCte caps recursion at the requested depth', () => {
  const cteDefault = reportingTreeCte();
  assert.match(cteDefault, new RegExp(`t\\.depth < ${MAX_REPORTING_DEPTH}`));

  const cteTwo = reportingTreeCte(2);
  assert.match(cteTwo, /t\.depth < 2/);

  // Clamped bounds: at least 1, at most MAX_REPORTING_DEPTH
  assert.match(reportingTreeCte(0), /t\.depth < 1/);
  assert.match(reportingTreeCte(99), new RegExp(`t\\.depth < ${MAX_REPORTING_DEPTH}`));
});
