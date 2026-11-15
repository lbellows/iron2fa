import AsyncStorage from '@react-native-async-storage/async-storage';
import { b64encode, utf8Encode } from '../core/bytes';
import { seal } from '../core/crypto';
import { Account, generateCode } from '../core/otp';
import * as vault from '../vault';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('expo-secure-store', () => {
  const items = new Map<string, string>();
  return {
    getItemAsync: async (k: string) => items.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => void items.set(k, v),
    deleteItemAsync: async (k: string) => void items.delete(k),
  };
});

const BLOB_KEY = 'iron2fa.vault.v1';
const AAD = 'iron2fa.vault.v1';
// 20 bytes whose base64 contains "/" — the shape a Steam shared_secret has.
const STEAM_B64 = 'ABEiM0RVZneImaq7zN3u/z//f/8=';

const totp: Account = {
  id: 'a', kind: 'totp', issuer: '', label: 'work:me@example.com', secret: 'JBSWY3DPEHPK3PXP',
  algorithm: 'SHA256', digits: 8, period: 60, note: 'n',
};
const steam: Account = {
  id: 'b', kind: 'steam', issuer: 'Steam alt', label: 'me', secret: STEAM_B64,
  algorithm: 'SHA1', digits: 5, period: 30, note: '',
};

beforeEach(async () => {
  await vault.destroy();
});

describe('vault', () => {
  it('reopens exactly what was saved', async () => {
    const { session } = await vault.openWithDeviceKey();
    await vault.save(session, [totp, steam]);
    expect((await vault.openWithDeviceKey()).accounts).toEqual([totp, steam]);
  });

  it('reads a version 1 vault, Steam secret intact, and rewrites it as version 2', async () => {
    const { session } = await vault.openWithDeviceKey();
    const v1Steam = { ...steam, issuer: 'Steam' };
    const doc = JSON.stringify({
      version: 1,
      entries: [{ id: v1Steam.id, content: { uri: `steam://${STEAM_B64}`, entry_type: 'Steam', name: 'me' }, note: null }],
    });
    const data = b64encode(seal(session.key, utf8Encode(doc), AAD));
    await AsyncStorage.setItem(BLOB_KEY, JSON.stringify({ v: 1, data }));

    const { accounts } = await vault.openWithDeviceKey();
    expect(accounts).toEqual([v1Steam]);
    expect(generateCode(accounts[0], 1700000000)).toBe(generateCode(v1Steam, 1700000000));

    await vault.save(session, accounts);
    expect(JSON.parse((await AsyncStorage.getItem(BLOB_KEY))!).v).toBe(2);
    expect((await vault.openWithDeviceKey()).accounts).toEqual([v1Steam]);
  });

  it('refuses a version 1 vault with an unreadable entry instead of dropping it', async () => {
    const { session } = await vault.openWithDeviceKey();
    const doc = JSON.stringify({
      version: 1,
      entries: [{ id: 'x', content: { uri: 'otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP', entry_type: 'Totp', name: 'x' }, note: null }],
    });
    await AsyncStorage.setItem(BLOB_KEY, JSON.stringify({ v: 1, data: b64encode(seal(session.key, utf8Encode(doc), AAD)) }));
    const error = await vault.openWithDeviceKey().catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(vault.VaultUnreadable);
    expect(error.message).toMatch(/could not be read/);
  });

  it('reports a blob it cannot decrypt or parse as unreadable', async () => {
    const { session } = await vault.openWithDeviceKey();
    await vault.save(session, [totp]);
    const blob = JSON.parse((await AsyncStorage.getItem(BLOB_KEY))!);
    await AsyncStorage.setItem(BLOB_KEY, JSON.stringify({ ...blob, data: b64encode(new Uint8Array(40)) }));
    await expect(vault.openWithDeviceKey()).rejects.toBeInstanceOf(vault.VaultUnreadable);
    await AsyncStorage.setItem(BLOB_KEY, '{not json');
    await expect(vault.openWithDeviceKey()).rejects.toBeInstanceOf(vault.VaultUnreadable);
  });

  it('tells a wrong passphrase from a vault with no salt', async () => {
    const { session } = await vault.createWithPassphrase('correct horse');
    await vault.save(session, [totp, steam]);
    expect((await vault.unlockWithPassphrase('correct horse')).accounts).toEqual([totp, steam]);
    await expect(vault.unlockWithPassphrase('wrong horse')).rejects.toBeInstanceOf(vault.WrongPassphrase);
    const blob = JSON.parse((await AsyncStorage.getItem(BLOB_KEY))!);
    await AsyncStorage.setItem(BLOB_KEY, JSON.stringify({ v: blob.v, data: blob.data }));
    await expect(vault.unlockWithPassphrase('correct horse')).rejects.toBeInstanceOf(vault.VaultUnreadable);
  });
});
