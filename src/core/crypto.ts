import { gcm } from '@noble/ciphers/aes';
import { argon2idAsync } from '@noble/hashes/argon2';
import { utf8Encode } from './bytes';

const NONCE_LENGTH = 12;

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** AES-256-GCM; the random 12-byte nonce is prepended to the ciphertext. */
export function seal(key: Uint8Array, plaintext: Uint8Array, aad: string): Uint8Array {
  const nonce = randomBytes(NONCE_LENGTH);
  const ciphertext = gcm(key, nonce, utf8Encode(aad)).encrypt(plaintext);
  const out = new Uint8Array(NONCE_LENGTH + ciphertext.length);
  out.set(nonce);
  out.set(ciphertext, NONCE_LENGTH);
  return out;
}

/** Throws if the key, the AAD or the data is wrong. */
export function open(key: Uint8Array, sealed: Uint8Array, aad: string): Uint8Array {
  if (sealed.length < NONCE_LENGTH) throw new Error('Ciphertext is too short');
  return gcm(key, sealed.subarray(0, NONCE_LENGTH), utf8Encode(aad)).decrypt(sealed.subarray(NONCE_LENGTH));
}

/** Argon2id cost: memory in KiB, passes, lanes. */
export interface KdfParams {
  m: number;
  t: number;
  p: number;
}

/**
 * What Proton Authenticator uses for its password-protected exports (19 MiB,
 * 2 passes, 1 lane), so it is fixed for reading those. The desktop vault uses
 * it too.
 */
export const PROTON_KDF: KdfParams = { m: 19 * 1024, t: 2, p: 1 };

/** For new Iron2FA backups. Written into each file, so changing it does not break old ones. */
export const BACKUP_KDF: KdfParams = PROTON_KDF;

/** Argon2id to a 32-byte key. */
export function deriveKey(password: string, salt: Uint8Array, params: KdfParams = PROTON_KDF): Promise<Uint8Array> {
  return argon2idAsync(utf8Encode(password), salt, { ...params, dkLen: 32 });
}
