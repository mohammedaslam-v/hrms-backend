import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canSeeCompensation,
  canSeeRestrictedFeedback,
  resolveProfileAccess,
  type ProfileViewerFacts,
} from './profile.domain';

const facts = (over: Partial<ProfileViewerFacts> = {}): ProfileViewerFacts => ({
  viewerId: 10,
  subjectId: 20,
  tiers: ['employee'],
  isReport: false,
  ...over,
});

describe('who may open a profile', () => {
  it('always lets someone open their own', () => {
    assert.equal(resolveProfileAccess(facts({ viewerId: 10, subjectId: 10 })), 'self');
  });

  it('records your own profile as self even when you are an admin', () => {
    // The reason matters: an audit line should say you read your own pay, not
    // that you exercised admin access over yourself.
    const access = resolveProfileAccess(
      facts({ viewerId: 10, subjectId: 10, tiers: ['employee', 'admin'] }),
    );
    assert.equal(access, 'self');
  });

  it('lets an admin open anyone', () => {
    assert.equal(resolveProfileAccess(facts({ tiers: ['employee', 'admin'] })), 'admin');
  });

  it('lets a manager open someone in their reporting tree', () => {
    assert.equal(
      resolveProfileAccess(facts({ tiers: ['employee', 'manager'], isReport: true })),
      'manager',
    );
  });

  it('refuses a manager someone outside their tree', () => {
    // Being a manager of somebody is not access to everybody.
    assert.equal(
      resolveProfileAccess(facts({ tiers: ['employee', 'manager'], isReport: false })),
      'denied',
    );
  });

  it('refuses a colleague', () => {
    assert.equal(resolveProfileAccess(facts()), 'denied');
  });
});

describe('what the viewer sees', () => {
  it('shows compensation to the employee and to an admin', () => {
    assert.equal(canSeeCompensation('self'), true);
    assert.equal(canSeeCompensation('admin'), true);
  });

  it('hides compensation from a manager viewing a report', () => {
    // Pay is between the employee, HR and the founder.
    assert.equal(canSeeCompensation('manager'), false);
    assert.equal(canSeeCompensation('denied'), false);
  });

  it('never shows managers-only feedback to its subject', () => {
    assert.equal(canSeeRestrictedFeedback('self'), false);
    assert.equal(canSeeRestrictedFeedback('manager'), true);
    assert.equal(canSeeRestrictedFeedback('admin'), true);
  });
});
