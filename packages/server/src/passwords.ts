import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// scrypt with Node's defaults raised a step: about 50 ms a hash on a small server.
const SCRYPT: ScryptOptions = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_BYTES = 32;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEY_BYTES, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** "scrypt$<salt>$<key>", both base64. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [kind, salt, key] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !key) return false;
  const want = Buffer.from(key, 'base64');
  const got = await derive(password, Buffer.from(salt, 'base64'));
  return got.length === want.length && timingSafeEqual(got, want);
}

/** A new session token for the browser to keep. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only this is stored, so a copy of the database can't be used to sign in. */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
