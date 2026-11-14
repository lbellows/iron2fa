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

/**
 * Argon2id with the parameters Proton Authenticator uses for its
 * password-protected exports (19 MiB, 2 passes, 1 lane, 32-byte key). The same
 * parameters protect the desktop vault, so there is one KDF to reason about.
 */
export function deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  return argon2idAsync(utf8Encode(password), salt, { m: 19 * 1024, t: 2, p: 1, dkLen: 32 });
}
