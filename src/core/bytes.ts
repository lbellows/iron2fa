import { base32nopad, base64, base64nopad } from '@scure/base';

// Hand-rolled UTF-8: Hermes does not reliably ship TextDecoder, and these two
// functions have to behave identically on Android, in the browser and in Node.
export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
  }
  return Uint8Array.from(out);
}

export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i++];
    let cp: number;
    if (b < 0x80) cp = b;
    else if (b < 0xe0) cp = ((b & 0x1f) << 6) | (bytes[i++] & 0x3f);
    else if (b < 0xf0) cp = ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    else
      cp =
        ((b & 0x07) << 18) |
        ((bytes[i++] & 0x3f) << 12) |
        ((bytes[i++] & 0x3f) << 6) |
        (bytes[i++] & 0x3f);
    out += String.fromCodePoint(cp);
  }
  return out;
}

export const b64encode = (bytes: Uint8Array): string => base64.encode(bytes);
export const b64decode = (text: string): Uint8Array => base64.decode(text);

/** Strip the separators people type into a setup key: "abcd efgh-ijkl==" -> "ABCDEFGHIJKL". */
export function sanitizeSecret(secret: string): string {
  return secret.replace(/[\s\-_]/g, '').replace(/=+$/, '').toUpperCase();
}

/** Decode a TOTP shared secret (base32, padding and separators optional). */
export function decodeBase32Secret(secret: string): Uint8Array {
  const clean = sanitizeSecret(secret);
  if (!clean) throw new Error('The secret is empty');
  try {
    return base32nopad.decode(clean);
  } catch {
    throw new Error('The secret is not valid base32');
  }
}

/**
 * Steam secrets are base32 when they come from an otpauth URI and base64 when
 * they come from the Steam app's own files. Proton tries base32 first, then
 * base64, so do the same.
 */
export function decodeSteamSecret(secret: string): Uint8Array {
  const trimmed = secret.trim().replace(/=+$/, '');
  if (!trimmed) throw new Error('The secret is empty');
  try {
    return base32nopad.decode(trimmed);
  } catch {
    try {
      return base64nopad.decode(trimmed);
    } catch {
      throw new Error('The Steam secret is neither base32 nor base64');
    }
  }
}
