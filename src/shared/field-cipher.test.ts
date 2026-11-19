import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import { FieldCipher } from './field-cipher';

const key = () => crypto.randomBytes(32);

describe('field cipher', () => {
  it('gets back exactly what went in', () => {
    const cipher = new FieldCipher({ v1: key() }, 'v1');
    const stored = cipher.encrypt('{"ctc":600000}', 'employee:336');
    assert.equal(cipher.decrypt(stored, 'employee:336'), '{"ctc":600000}');
  });

  it('does not store the value in readable form', () => {
    const cipher = new FieldCipher({ v1: key() }, 'v1');
    const stored = cipher.encrypt('{"ctc":600000}', 'employee:336');
    assert.match(stored, /^v1:[^:]+:[^:]+:[^:]+$/);
    assert.ok(!stored.includes('600000'));
  });

  it('gives two equal salaries different stored text', () => {
    // Otherwise anyone reading the table could see who earns the same.
    const cipher = new FieldCipher({ v1: key() }, 'v1');
    assert.notEqual(
      cipher.encrypt('{"ctc":600000}', 'employee:1'),
      cipher.encrypt('{"ctc":600000}', 'employee:1'),
    );
  });

  it('refuses a value copied onto another employee', () => {
    // Someone with write access to the table must not be able to give
    // themselves a colleague's salary by copying the encrypted text across.
    const cipher = new FieldCipher({ v1: key() }, 'v1');
    const stored = cipher.encrypt('{"ctc":2400000}', 'employee:10');
    assert.throws(() => cipher.decrypt(stored, 'employee:11'));
  });

  it('refuses a value that was edited', () => {
    const cipher = new FieldCipher({ v1: key() }, 'v1');
    const [v, iv, tag, body] = cipher.encrypt('{"ctc":600000}', 'employee:336').split(':');
    const flipped = Buffer.from(body, 'base64');
    flipped[0] ^= 1;
    assert.throws(() => cipher.decrypt([v, iv, tag, flipped.toString('base64')].join(':'), 'employee:336'));
  });

  it('refuses the wrong key', () => {
    const stored = new FieldCipher({ v1: key() }, 'v1').encrypt('x', 'employee:1');
    assert.throws(() => new FieldCipher({ v1: key() }, 'v1').decrypt(stored, 'employee:1'));
  });

  it('still reads old values after a new key is added', () => {
    const v1 = key();
    const before = new FieldCipher({ v1 }, 'v1').encrypt('old', 'employee:1');
    const after = new FieldCipher({ v1, v2: key() }, 'v2');
    assert.equal(after.decrypt(before, 'employee:1'), 'old');
    assert.match(after.encrypt('new', 'employee:1'), /^v2:/);
  });

  it('rejects a key of the wrong length', () => {
    assert.throws(() => new FieldCipher({ v1: crypto.randomBytes(16) }, 'v1'), /32 bytes/);
    assert.throws(() => FieldCipher.keyFromBase64('KEY', 'c2hvcnQ='), /32 random bytes/);
  });
});
