/**
 * The accounts at rest: one AES-256-GCM blob in AsyncStorage (localStorage on
 * the desktop build). What differs per platform is where the key comes from.
 *
 *   Android  a random key held in the Android Keystore via expo-secure-store,
 *            so the vault opens without a prompt and is useless off the device.
 *   Desktop  a key derived from a passphrase with Argon2id, because a desktop
 *            has no equivalent of the Keystore that every install can rely on.
 *
 * The plaintext is the account list as JSON (blob version 2). Version 1 held a
 * Proton Authenticator export instead, which cannot represent every account:
 * reading it back cut Steam secrets at a "/" and renamed some accounts. Those
 * vaults are still read, and are rewritten as version 2 on the next save.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { b64decode, b64encode, utf8Decode, utf8Encode } from './core/bytes';
import { deriveKey, open, randomBytes, seal } from './core/crypto';
import { Account, isAccount } from './core/otp';
import { importExport } from './core/proton';

const BLOB_KEY = 'iron2fa.vault.v1';
const SECURE_KEY = 'iron2fa.vaultkey.v1';
const AAD = 'iron2fa.vault.v1';

export const usesPassphrase = Platform.OS === 'web';

export interface Session {
  key: Uint8Array;
  /** Present on passphrase vaults; stored beside the blob so the key can be re-derived. */
  salt?: Uint8Array;
}

interface Blob {
  v: 1 | 2;
  salt?: string;
  data: string;
}

export class WrongPassphrase extends Error {
  constructor() {
    super('Wrong passphrase');
  }
}

/** The vault exists but cannot be decrypted with the key this device holds. */
export class VaultUnreadable extends Error {
  constructor() {
    super('The saved accounts cannot be decrypted on this device');
  }
}

async function readBlob(): Promise<Blob | null> {
  const raw = await AsyncStorage.getItem(BLOB_KEY);
  if (!raw) return null;
  let blob: Partial<Blob> | null;
  try {
    blob = JSON.parse(raw);
  } catch {
    throw new VaultUnreadable();
  }
  if (typeof blob !== 'object' || blob === null || typeof blob.data !== 'string') throw new VaultUnreadable();
  if (blob.v !== 1 && blob.v !== 2) throw new Error('The saved accounts were written by a newer version of Iron2FA');
  return blob as Blob;
}

/** Throws `wrongKey` when the blob does not decrypt, a plain Error when what it holds cannot be read. */
async function decrypt(session: Session, blob: Blob, wrongKey: Error): Promise<Account[]> {
  let text: string;
  try {
    text = utf8Decode(open(session.key, b64decode(blob.data), AAD));
  } catch {
    throw wrongKey;
  }
  if (blob.v === 1) {
    // Never drop an entry quietly: the next save would make the loss permanent.
    const { accounts, errors } = await importExport(text);
    if (errors.length) throw new Error(`Some saved accounts could not be read (${errors.join('; ')})`);
    return accounts;
  }
  const accounts: unknown = JSON.parse(text);
  if (!Array.isArray(accounts) || !accounts.every(isAccount)) throw new Error('The saved accounts are damaged');
  return accounts;
}

export async function vaultExists(): Promise<boolean> {
  return (await AsyncStorage.getItem(BLOB_KEY)) !== null;
}

export async function save(session: Session, accounts: Account[]): Promise<void> {
  const blob: Blob = {
    v: 2,
    data: b64encode(seal(session.key, utf8Encode(JSON.stringify(accounts)), AAD)),
  };
  if (session.salt) blob.salt = b64encode(session.salt);
  await AsyncStorage.setItem(BLOB_KEY, JSON.stringify(blob));
}

/** Android: open the vault with the Keystore-held key, creating both on first run. */
export async function openWithDeviceKey(): Promise<{ session: Session; accounts: Account[] }> {
  const blob = await readBlob();
  const stored = await SecureStore.getItemAsync(SECURE_KEY);
  if (!blob) {
    const key = stored ? b64decode(stored) : randomBytes(32);
    if (!stored) await SecureStore.setItemAsync(SECURE_KEY, b64encode(key));
    return { session: { key }, accounts: [] };
  }
  if (!stored) throw new VaultUnreadable();
  const session = { key: b64decode(stored) };
  return { session, accounts: await decrypt(session, blob, new VaultUnreadable()) };
}

/** Desktop, first run. */
export async function createWithPassphrase(passphrase: string): Promise<{ session: Session; accounts: Account[] }> {
  const salt = randomBytes(16);
  const session = { key: await deriveKey(passphrase, salt), salt };
  await save(session, []);
  return { session, accounts: [] };
}

/** Desktop, every later run. */
export async function unlockWithPassphrase(passphrase: string): Promise<{ session: Session; accounts: Account[] }> {
  const blob = await readBlob();
  if (!blob?.salt) throw new VaultUnreadable();
  const salt = b64decode(blob.salt);
  const session = { key: await deriveKey(passphrase, salt), salt };
  return { session, accounts: await decrypt(session, blob, new WrongPassphrase()) };
}

/** Delete everything. Only reachable from the screen shown when the vault will not open. */
export async function destroy(): Promise<void> {
  await AsyncStorage.removeItem(BLOB_KEY);
  if (!usesPassphrase) await SecureStore.deleteItemAsync(SECURE_KEY);
}
