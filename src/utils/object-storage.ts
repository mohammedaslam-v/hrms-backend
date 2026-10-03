import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Storage } from '@google-cloud/storage';
import { env } from '../config/env';

/**
 * Where uploaded files live.
 *
 * Cloud Run's filesystem is ephemeral: anything written under /app is gone when
 * the instance recycles, and is invisible to a second instance serving the same
 * user. Documents written to disk there survive until the next deploy and no
 * longer. So in production they go to Google Cloud Storage instead.
 *
 * Local development keeps writing to ./uploads — GCS_BUCKET unset selects disk,
 * so nobody needs service-account credentials to run the app.
 *
 * STORED KEYS
 *   GCS objects are keyed `hrms/documents/…` and `hrms/reimbursements/…`.
 *   Rows written before this change hold `uploads/documents/…`, which still
 *   resolves on disk — `isRemoteKey` is what tells the two apart, so old files
 *   keep working rather than turning into dead links.
 *
 * ACCESS
 *   Nothing here sets a public ACL and no storage.googleapis.com URL is ever
 *   handed out: every download is streamed by an authenticated route after it
 *   has checked who is asking. Note this does NOT make the objects private if
 *   the bucket itself grants allUsers read — bambinos-main does, and also
 *   permits anonymous listing, so treat anything written here as readable by
 *   anyone who knows the bucket.
 */

const REMOTE_PREFIX = 'hrms/';

let client: Storage | null = null;

const storage = (): Storage => {
  // Application Default Credentials: on Cloud Run this is the service account,
  // with no key file to ship or rotate.
  client ??= new Storage(
    env.gcs.projectId ? { projectId: env.gcs.projectId } : {},
  );
  return client;
};

export const isGcsEnabled = (): boolean => Boolean(env.gcs.bucket);

/** True for a key this module stored remotely, false for a legacy disk path. */
export const isRemoteKey = (key: string): boolean => key.startsWith(REMOTE_PREFIX);

/**
 * `<folder>/<employeeId>_<label>_<timestamp>_<random>.<ext>`
 *
 * The random suffix is what stops one object key being derived from another.
 * The timestamp alone is guessable, and employee ids are sequential.
 */
export function buildKey(
  folder: 'documents' | 'reimbursements',
  employeeId: number,
  label: string,
  ext: string,
): string {
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '') || 'file';
  const nonce = crypto.randomBytes(6).toString('hex');
  return `${REMOTE_PREFIX}${folder}/${employeeId}_${safeLabel}_${Date.now()}_${nonce}.${ext}`;
}

/** The on-disk equivalent of a key, for local development. */
const localPathFor = (key: string): string =>
  path.resolve(process.cwd(), key.startsWith(REMOTE_PREFIX) ? key.slice(REMOTE_PREFIX.length) : key);

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  if (isGcsEnabled()) {
    await storage()
      .bucket(env.gcs.bucket)
      .file(key)
      // `public: false` is not a guarantee — a bucket-level allUsers grant wins.
      // It only ensures this code never widens access on its own.
      .save(body, { contentType, resumable: false, public: false });
    return;
  }

  const full = localPathFor(key);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.writeFile(full, body);
}

export async function getObject(key: string): Promise<Buffer> {
  if (isGcsEnabled() && isRemoteKey(key)) {
    const [buf] = await storage().bucket(env.gcs.bucket).file(key).download();
    return buf;
  }
  return fs.promises.readFile(localPathFor(key));
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    if (isGcsEnabled() && isRemoteKey(key)) {
      const [exists] = await storage().bucket(env.gcs.bucket).file(key).exists();
      return exists;
    }
    return fs.existsSync(localPathFor(key));
  } catch {
    return false;
  }
}

/** Never throws: a file that has already gone is the outcome we wanted. */
export async function removeObject(key: string): Promise<void> {
  try {
    if (isGcsEnabled() && isRemoteKey(key)) {
      await storage().bucket(env.gcs.bucket).file(key).delete({ ignoreNotFound: true });
      return;
    }
    await fs.promises.unlink(localPathFor(key)).catch(() => {});
  } catch {
    /* ignore */
  }
}

const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

export const contentTypeFor = (ext: string): string =>
  CONTENT_TYPES[ext.toLowerCase()] ?? 'application/octet-stream';
