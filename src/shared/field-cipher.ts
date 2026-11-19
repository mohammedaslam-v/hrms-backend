import crypto from 'crypto';

/**
 * Encrypts a value before it is written to a column, and decrypts it after it
 * is read back.
 *
 * Why the application and not the database: HRMS shares its schema with the
 * live admin portals, so anyone with SQL access to those can read HRMS tables.
 * MariaDB/MySQL "encryption at rest" only protects the files on disk — a SQL
 * user still sees plain values — and AES_ENCRYPT() would put the key inside
 * every query, where query logs and Adminer history keep it. Here the key
 * never leaves this process.
 *
 * Stored format: `v1:<iv>:<tag>:<ciphertext>`, each part base64.
 *   - `v1` names the key, so a new key can be added later without breaking
 *     rows written with the old one.
 *   - `iv` is fresh random bytes per value, so two people on the same salary
 *     get different text and nobody can spot that they match.
 *   - `tag` is GCM's tamper seal: an edited value fails to decrypt instead of
 *     quietly returning a wrong number.
 *
 * `context` is bound into the seal (GCM "additional data") but not stored. The
 * caller passes something that identifies the row's owner, so a ciphertext
 * copied from one employee's row into another's will not decrypt there.
 */
export interface IFieldCipher {
  encrypt(plain: string, context: string): string;
  decrypt(stored: string, context: string): string;
}

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export class FieldCipher implements IFieldCipher {
  /**
   * @param keys    every key that may have written a stored value, by version
   * @param current the version new values are written with
   */
  constructor(
    private readonly keys: Readonly<Record<string, Buffer>>,
    private readonly current: string,
  ) {
    for (const [version, key] of Object.entries(keys)) {
      if (!/^v\d+$/.test(version)) {
        throw new Error(`Encryption key version "${version}" must look like v1, v2, …`);
      }
      if (key.length !== KEY_BYTES) {
        throw new Error(`Encryption key ${version} must be ${KEY_BYTES} bytes, got ${key.length}.`);
      }
    }
    if (!keys[current]) {
      throw new Error(`No encryption key for the current version "${current}".`);
    }
  }

  /** A key as it is written in .env: 32 random bytes, base64. */
  static keyFromBase64(name: string, value: string): Buffer {
    const key = Buffer.from(value.trim(), 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `${name} must be ${KEY_BYTES} random bytes in base64 (got ${key.length} bytes). ` +
          `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
      );
    }
    return key;
  }

  encrypt(plain: string, context: string): string {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, this.keys[this.current], iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [this.current, iv.toString('base64'), tag.toString('base64'), body.toString('base64')].join(':');
  }

  decrypt(stored: string, context: string): string {
    const parts = stored.split(':');
    if (parts.length !== 4) {
      throw new Error('Encrypted value is not in the v1:iv:tag:data format.');
    }
    const [version, iv, tag, body] = parts;
    const key = this.keys[version];
    if (!key) {
      throw new Error(`No key configured for encrypted value version "${version}".`);
    }
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    // final() throws when the seal does not match: a wrong key, a wrong row,
    // or text someone edited. Never caught here — a salary we cannot vouch
    // for must not be shown or paid.
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
  }
}
