/**
 * Iron2FA's own backup file, and the one entry point for reading any file the
 * app can import (its own backups and Proton Authenticator exports).
 *
 * Plain:      {"format":"iron2fa","version":1,"accounts":[Account, ...]}
 * Encrypted:  {"format":"iron2fa","version":1,"kdf":{"name":"argon2id","m","t","p"},
 *              "salt":"<base64>","data":"<base64 nonce||ciphertext>"}
 *
 * The accounts are written as they are held, so nothing is lost on the way
 * through a file. The encrypted form is the plain document under AES-256-GCM
 * with an Argon2id key; the KDF cost is recorded in the file so it can be
 * raised later without stranding old backups.
 */
import { b64decode, b64encode, decodeBase32Secret, decodeSteamSecret, utf8Decode, utf8Encode } from './bytes';
import { BACKUP_KDF, KdfParams, deriveKey, open, randomBytes, seal } from './crypto';
import { Account, generateCode, isAccount, newId } from './otp';
import { BadPassword, ImportResult, PasswordRequired, importExport, isEncryptedExport } from './proton';

const FORMAT = 'iron2fa';
const AAD = 'iron2fa.backup.v1';

type Doc = Record<string, unknown>;

/** The document if `text` is an Iron2FA backup, null if it is something else. */
function ownDoc(text: string): Doc | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || (parsed as Doc).format !== FORMAT) return null;
  const doc = parsed as Doc;
  if (doc.version !== 1) throw new Error(`This backup was made by a newer version of Iron2FA (format ${String(doc.version)})`);
  return doc;
}

function readKdf(raw: unknown): KdfParams {
  const k = raw as { name?: unknown; m?: unknown; t?: unknown; p?: unknown } | null;
  const whole = (n: unknown, min: number, max: number) => Number.isInteger(n) && (n as number) >= min && (n as number) <= max;
  // The ceilings keep a hostile file from asking for gigabytes or minutes.
  if (typeof k !== 'object' || k === null || k.name !== 'argon2id' || !whole(k.p, 1, 4) ||
      !whole(k.m, 8 * (k.p as number), 1024 * 1024) || !whole(k.t, 1, 16)) {
    throw new Error('The backup uses key-derivation settings this version cannot read');
  }
  return { m: k.m as number, t: k.t as number, p: k.p as number };
}

function readAccounts(doc: Doc): ImportResult {
  if (!Array.isArray(doc.accounts)) throw new Error('The backup is damaged');
  const accounts: Account[] = [];
  const errors: string[] = [];
  doc.accounts.forEach((raw: unknown, index: number) => {
    const named = raw as Partial<Account> | null;
    const name = (typeof named?.label === 'string' && named.label) || (typeof named?.issuer === 'string' && named.issuer) || `entry ${index + 1}`;
    try {
      if (!isAccount(raw)) throw new Error('not a valid account');
      generateCode(raw, 0); // proves the secret decodes
      accounts.push({ ...raw, id: raw.id || newId() });
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  return { accounts, errors };
}

/** True when the file needs a password before it can be read. */
export function needsPassword(text: string): boolean {
  const doc = ownDoc(text);
  return doc ? !('accounts' in doc) : isEncryptedExport(text);
}

/**
 * Read an Iron2FA backup or a Proton Authenticator export. Throws
 * PasswordRequired when the file is encrypted and no password was given,
 * BadPassword when it does not decrypt.
 */
export async function readBackup(text: string, password?: string): Promise<ImportResult> {
  const doc = ownDoc(text);
  if (!doc) return importExport(text, password);
  if ('accounts' in doc) return readAccounts(doc);
  if (typeof doc.salt !== 'string' || typeof doc.data !== 'string') throw new Error('The backup is damaged');
  if (!password) throw new PasswordRequired();

  const kdf = readKdf(doc.kdf);
  let salt: Uint8Array;
  let sealed: Uint8Array;
  try {
    salt = b64decode(doc.salt);
    sealed = b64decode(doc.data);
  } catch {
    throw new Error('The backup is damaged');
  }
  const key = await deriveKey(password, salt, kdf);
  let plain: Uint8Array;
  try {
    plain = open(key, sealed, AAD);
  } catch {
    throw new BadPassword();
  }
  const inner = ownDoc(utf8Decode(plain));
  if (!inner) throw new Error('The backup is damaged');
  return readAccounts(inner);
}

/** Write a backup; encrypted when a password is given. */
export async function writeBackup(accounts: Account[], password?: string): Promise<string> {
  const plain = JSON.stringify({ format: FORMAT, version: 1, accounts });
  if (!password) return plain;
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, BACKUP_KDF);
  return JSON.stringify({
    format: FORMAT,
    version: 1,
    kdf: { name: 'argon2id', ...BACKUP_KDF },
    salt: b64encode(salt),
    data: b64encode(seal(key, utf8Encode(plain), AAD)),
  });
}

/**
 * What makes two accounts the same account: the key and how codes are made
 * from it, whatever they are called. The key is compared as bytes, so spacing,
 * case and base32-versus-base64 do not make one secret look like two.
 */
function identity(a: Account): string {
  let secret: string;
  try {
    secret = b64encode(a.kind === 'steam' ? decodeSteamSecret(a.secret) : decodeBase32Secret(a.secret));
  } catch {
    secret = `raw:${a.secret}`;
  }
  return [a.kind, secret, a.algorithm, a.digits, a.period].join('|');
}

/** Add `incoming` to `existing`, skipping anything already present by id or by secret. */
export function mergeAccounts(existing: Account[], incoming: Account[]): { merged: Account[]; added: number } {
  const ids = new Set(existing.map((a) => a.id));
  const secrets = new Set(existing.map(identity));
  const merged = [...existing];
  let added = 0;
  for (const account of incoming) {
    const secret = identity(account);
    if (ids.has(account.id) || secrets.has(secret)) continue;
    ids.add(account.id);
    secrets.add(secret);
    merged.push(account);
    added++;
  }
  return { merged, added };
}
