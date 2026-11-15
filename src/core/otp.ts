import { hmac } from '@noble/hashes/hmac';
import { sha1 } from '@noble/hashes/sha1';
import { sha256, sha512 } from '@noble/hashes/sha2';
import { decodeBase32Secret, decodeSteamSecret, sanitizeSecret } from './bytes';

export type Algorithm = 'SHA1' | 'SHA256' | 'SHA512';
export type Kind = 'totp' | 'steam';

export interface Account {
  id: string;
  kind: Kind;
  /** Service name, e.g. "GitHub". May be empty. */
  issuer: string;
  /** Account name, e.g. "me@example.com". May be empty. */
  label: string;
  /** As written in the URI: base32 for TOTP, base32 or base64 for Steam. */
  secret: string;
  algorithm: Algorithm;
  digits: number;
  period: number;
  note: string;
}

/** Whether `x` has the shape and ranges of an Account. Does not prove the secret decodes. */
export function isAccount(x: unknown): x is Account {
  const a = x as Account | null;
  return (
    typeof a === 'object' && a !== null &&
    typeof a.id === 'string' && (a.kind === 'totp' || a.kind === 'steam') &&
    typeof a.issuer === 'string' && typeof a.label === 'string' && typeof a.secret === 'string' &&
    (a.algorithm === 'SHA1' || a.algorithm === 'SHA256' || a.algorithm === 'SHA512') &&
    Number.isInteger(a.digits) && a.digits >= 4 && a.digits <= 10 &&
    Number.isInteger(a.period) && a.period >= 1 && a.period <= 86400 &&
    typeof a.note === 'string'
  );
}

const HASHES = { SHA1: sha1, SHA256: sha256, SHA512: sha512 };
const STEAM_CHARS = '23456789BCDFGHJKMNPQRTVWXY';
const STEAM_DIGITS = 5;

function counterBytes(counter: number): Uint8Array {
  const out = new Uint8Array(8);
  let rest = counter;
  for (let i = 7; i >= 0; i--) {
    out[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  return out;
}

/** RFC 4226 dynamic truncation: a 31-bit integer taken from the MAC. */
function truncate(mac: Uint8Array): number {
  const offset = mac[mac.length - 1] & 0x0f;
  return (
    ((mac[offset] & 0x7f) * 0x1000000) +
    (mac[offset + 1] << 16) +
    (mac[offset + 2] << 8) +
    mac[offset + 3]
  );
}

/** The code for `account` at `unixSeconds`. Throws if the secret cannot be decoded. */
export function generateCode(account: Account, unixSeconds: number): string {
  const counter = counterBytes(Math.floor(unixSeconds / account.period));
  if (account.kind === 'steam') {
    let value = truncate(hmac(sha1, decodeSteamSecret(account.secret), counter));
    let code = '';
    for (let i = 0; i < STEAM_DIGITS; i++) {
      code += STEAM_CHARS[value % STEAM_CHARS.length];
      value = Math.floor(value / STEAM_CHARS.length);
    }
    return code;
  }
  const value = truncate(hmac(HASHES[account.algorithm], decodeBase32Secret(account.secret), counter));
  return String(value % 10 ** account.digits).padStart(account.digits, '0');
}

/** Seconds until the current code for `account` expires, in (0, period]. */
export function secondsRemaining(account: Account, unixSeconds: number): number {
  return account.period - (unixSeconds % account.period);
}

export function newId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function decodeComponent(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function parseQuery(query: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = eq < 0 ? pair : pair.slice(0, eq);
    const value = eq < 0 ? '' : pair.slice(eq + 1);
    out.set(decodeComponent(key).toLowerCase(), decodeComponent(value.replace(/\+/g, ' ')));
  }
  return out;
}

function parseIntParam(value: string | undefined, fallback: number, name: string, min: number, max: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Unsupported ${name}: ${value}`);
  return n;
}

/**
 * Parse an `otpauth://totp/...` or `steam://...` URI. The URL class is avoided
 * on purpose: React Native's implementation is incomplete for custom schemes.
 */
export function parseUri(uri: string, id: string = newId()): Account {
  const text = uri.trim();

  // Everything after the scheme is the secret: base64 secrets contain "/".
  const steam = /^steam:\/\/(.+)$/i.exec(text);
  if (steam) {
    const secret = decodeComponent(steam[1]);
    decodeSteamSecret(secret);
    return { id, kind: 'steam', issuer: 'Steam', label: '', secret, algorithm: 'SHA1', digits: STEAM_DIGITS, period: 30, note: '' };
  }

  const m = /^otpauth:\/\/([^/?#]*)\/?([^?#]*)\??([^#]*)/i.exec(text);
  if (!m) throw new Error('Not an otpauth:// or steam:// URI');
  const type = m[1].toLowerCase();
  if (type === 'hotp') throw new Error('Counter-based (HOTP) accounts are not supported');
  if (type !== 'totp' && type !== 'steam') throw new Error(`Unsupported OTP type: ${m[1] || '(none)'}`);

  const query = parseQuery(m[3]);
  const rawSecret = query.get('secret');
  if (!rawSecret) throw new Error('The URI has no secret');

  // The label is "Issuer:account" or just "account"; the issuer parameter wins
  // when both are present.
  const path = decodeComponent(m[2].split('/').pop() ?? '').trim();
  const colon = path.indexOf(':');
  let issuer = (query.get('issuer') ?? '').trim();
  let label = path;
  if (colon >= 0) {
    const prefix = path.slice(0, colon).trim();
    if (!issuer || issuer === prefix) {
      issuer = issuer || prefix;
      label = path.slice(colon + 1).trim();
    }
  }

  if (type === 'steam') {
    decodeSteamSecret(rawSecret);
    return { id, kind: 'steam', issuer: issuer || 'Steam', label, secret: rawSecret, algorithm: 'SHA1', digits: STEAM_DIGITS, period: 30, note: '' };
  }

  const secret = sanitizeSecret(rawSecret);
  decodeBase32Secret(secret);
  const algorithm = (query.get('algorithm') || 'SHA1').toUpperCase().replace('-', '');
  if (algorithm !== 'SHA1' && algorithm !== 'SHA256' && algorithm !== 'SHA512') {
    throw new Error(`Unsupported algorithm: ${query.get('algorithm')}`);
  }
  return {
    id,
    kind: 'totp',
    issuer,
    label,
    secret,
    algorithm,
    digits: parseIntParam(query.get('digits'), 6, 'digits', 4, 10),
    period: parseIntParam(query.get('period'), 30, 'period', 1, 86400),
    note: '',
  };
}
