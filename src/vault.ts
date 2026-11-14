/**
 * The accounts at rest: one AES-256-GCM blob in AsyncStorage (localStorage on
 * the desktop build). What differs per platform is where the key comes from.
 *
 *   Android  a random key held in the Android Keystore via expo-secure-store,
 *            so the vault opens without a prompt and is useless off the device.
 *   Desktop  a key derived from a passphrase with Argon2id, because a desktop
 *            has no equivalent of the Keystore that every install can rely on.
 *
 * The plaintext is a Proton Authenticator export document, so backup, restore
 * and Proton import all go through the same reader and writer.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { b64decode, b64encode, utf8Decode, utf8Encode } from './core/bytes';
import { deriveKey, open, randomBytes, seal } from './core/crypto';
import { Account } from './core/otp';
import { exportPlain, importExport } from './core/proton';

const BLOB_KEY = 'tumbler.vault.v1';
const SECURE_KEY = 'tumbler.vaultkey.v1';
const AAD = 'tumbler.vault.v1';

export const usesPassphrase = Platform.OS === 'web';

export interface Session {
  key: Uint8Array;
  /** Present on passphrase vaults; stored beside the blob so the key can be re-derived. */
  salt?: Uint8Array;
}

interface Blob {
  v: 1;
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
  return raw ? (JSON.parse(raw) as Blob) : null;
}

async function decrypt(session: Session, blob: Blob): Promise<Account[]> {
  const plain = open(session.key, b64decode(blob.data), AAD);
  return (await importExport(utf8Decode(plain))).accounts;
}

export async function vaultExists(): Promise<boolean> {
  return (await AsyncStorage.getItem(BLOB_KEY)) !== null;
}

export async function save(session: Session, accounts: Account[]): Promise<void> {
  const blob: Blob = {
    v: 1,
    data: b64encode(seal(session.key, utf8Encode(exportPlain(accounts)), AAD)),
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
  try {
    return { session, accounts: await decrypt(session, blob) };
  } catch {
    throw new VaultUnreadable();
  }
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
  try {
    return { session, accounts: await decrypt(session, blob) };
  } catch {
    throw new WrongPassphrase();
  }
}

/** Delete everything. Only reachable from the unreadable-vault screen. */
export async function destroy(): Promise<void> {
  await AsyncStorage.removeItem(BLOB_KEY);
  if (!usesPassphrase) await SecureStore.deleteItemAsync(SECURE_KEY);
}
