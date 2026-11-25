import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickMailProvider } from './mailer';

/**
 * EMAIL_PROVIDER is the one knob ops flip in Cloud Run during an SES incident.
 * Only the exact word "postmark" may route to the fallback; everything else,
 * including unset and typos, must stay on SES.
 */
describe('pickMailProvider', () => {
  it('defaults to SES when the variable is unset or blank', () => {
    assert.equal(pickMailProvider(undefined), 'ses');
    assert.equal(pickMailProvider(''), 'ses');
    assert.equal(pickMailProvider('   '), 'ses');
  });

  it('selects Postmark only for "postmark", ignoring case and spaces', () => {
    assert.equal(pickMailProvider('postmark'), 'postmark');
    assert.equal(pickMailProvider('Postmark'), 'postmark');
    assert.equal(pickMailProvider(' POSTMARK '), 'postmark');
  });

  it('keeps SES for anything else, including typos', () => {
    assert.equal(pickMailProvider('ses'), 'ses');
    assert.equal(pickMailProvider('SES'), 'ses');
    assert.equal(pickMailProvider('postmrk'), 'ses');
    assert.equal(pickMailProvider('sendgrid'), 'ses');
  });
});
