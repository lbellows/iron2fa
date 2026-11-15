/**
 * Reading Proton Authenticator's export format. Iron2FA does not write it: its
 * own backups are in backup.ts. Version 1 vaults also held this document.
 *
 * Plain:      {"version":1,"entries":[{"id","content":{"uri","entry_type","name"},"note"}]}
 * Encrypted:  {"version":1,"salt":"<base64>","content":"<base64 nonce||ciphertext>"}
 *
 * The encrypted form wraps the plain JSON in AES-256-GCM under an Argon2id key.
 * Reference: protonpass/proton-pass-common, proton-authenticator/src/entry/
 * exporter.rs and password_exporter.rs.
 */
import { b64decode, b64encode, utf8Decode, utf8Encode } from './bytes';
import { deriveKey, open } from './crypto';
import { Account, newId, parseUri } from './otp';

const EXPORT_AAD = 'proton.authenticator.export.v1';

interface ExportedEntry {
  id: string;
  content: { uri: string; entry_type: 'Totp' | 'Steam'; name: string | null };
  note: string | null;
}

export interface ImportResult {
  accounts: Account[];
  /** One human-readable line per entry that could not be read. */
  errors: string[];
}

export class PasswordRequired extends Error {
  constructor() {
    super('This export is password-protected');
  }
}

export class BadPassword extends Error {
  constructor() {
    super('Wrong password');
  }
}

function parseJson(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The file is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('The file is not a Proton Authenticator export');
  }
  const doc = parsed as Record<string, unknown>;
  if (doc.version !== 1) throw new Error(`Unsupported export version: ${String(doc.version)}`);
  return doc;
}

export function isEncryptedExport(text: string): boolean {
  const doc = parseJson(text);
  return 'salt' in doc && !('entries' in doc);
}

function importPlain(doc: Record<string, unknown>): ImportResult {
  if (!Array.isArray(doc.entries)) throw new Error('The file is not a Proton Authenticator export');
  const accounts: Account[] = [];
  const errors: string[] = [];
  doc.entries.forEach((raw, index) => {
    const entry = raw as Partial<ExportedEntry> | null;
    const name = entry?.content?.name || `entry ${index + 1}`;
    try {
      const uri = entry?.content?.uri;
      if (typeof uri !== 'string') throw new Error('no URI');
      const account = parseUri(uri, typeof entry?.id === 'string' && entry.id ? entry.id : newId());
      if (entry?.content?.entry_type === 'Steam' && account.kind !== 'steam') {
        throw new Error('marked as Steam but is not a steam:// URI');
      }
      // A steam:// URI carries no name, and a TOTP URI may carry no label.
      if (!account.label && entry?.content?.name && entry.content.name !== account.issuer) {
        account.label = entry.content.name;
      }
      account.note = typeof entry?.note === 'string' ? entry.note : '';
      accounts.push(account);
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  return { accounts, errors };
}

/**
 * Read a Proton Authenticator export. Throws PasswordRequired when the file is
 * encrypted and no password was given, BadPassword when it does not decrypt.
 */
export async function importExport(text: string, password?: string): Promise<ImportResult> {
  const doc = parseJson(text);
  if ('entries' in doc) return importPlain(doc);
  if (typeof doc.salt !== 'string' || typeof doc.content !== 'string') {
    throw new Error('The file is not a Proton Authenticator export');
  }
  if (!password) throw new PasswordRequired();

  let salt: Uint8Array;
  let sealed: Uint8Array;
  try {
    salt = b64decode(doc.salt);
    sealed = b64decode(doc.content);
  } catch {
    throw new Error('The encrypted export is corrupt');
  }
  const key = await deriveKey(password, salt);
  let plain: Uint8Array;
  try {
    plain = open(key, sealed, EXPORT_AAD);
  } catch {
    throw new BadPassword();
  }
  return importPlain(parseJson(utf8Decode(plain)));
}
