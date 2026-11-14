import * as nodeCrypto from 'node:crypto';
import { generateCode } from '../otp';
import {
  BadPassword, PasswordRequired, exportEncrypted, exportPlain, importExport, isEncryptedExport, mergeAccounts,
} from '../proton';

// The shape Proton Authenticator writes (serde output of AuthenticatorEntriesExport
// in proton-authenticator/src/entry/exporter.rs).
const PLAIN = JSON.stringify({
  version: 1,
  entries: [
    {
      id: '0b5c7d0e-6a7b-4a35-9d0c-0b1f7a3c2e11',
      content: {
        uri: 'otpauth://totp/octo%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&algorithm=SHA1&digits=6&period=30',
        entry_type: 'Totp',
        name: 'octo@example.com',
      },
      note: 'work account',
    },
    {
      id: '5a0a1f5e-0f0e-4c7f-8f58-0d3d2f0f7a22',
      content: {
        uri: 'otpauth://totp/?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA&issuer=Example%20Corp&algorithm=SHA256&digits=8&period=60',
        entry_type: 'Totp',
        name: 'Example Corp',
      },
      note: null,
    },
    {
      id: '9d2f6c1b-3b6f-4a0e-b0f4-2c7f6f1f0b33',
      content: { uri: 'steam://STEAMKEY', entry_type: 'Steam', name: 'gamer' },
      note: null,
    },
  ],
});

const PASSWORD = 'correct horse battery ✓';
const AAD = Buffer.from('proton.authenticator.export.v1');

// Proton's password export, rebuilt on OpenSSL (Node's crypto) rather than on
// the libraries the app uses, so the two implementations check each other.
// Parameters from proton-authenticator/src/entry/password_exporter.rs.
const argon2Sync = (nodeCrypto as any).argon2Sync as (alg: string, params: object) => Buffer;
function referenceKey(password: string, salt: Buffer): Buffer {
  return argon2Sync('argon2id', {
    message: Buffer.from(password, 'utf8'), nonce: salt, parallelism: 1, tagLength: 32, memory: 19 * 1024, passes: 2,
  });
}
function referenceEncrypt(plain: string, password: string): string {
  const salt = nodeCrypto.randomBytes(16);
  const nonce = nodeCrypto.randomBytes(12);
  const cipher = nodeCrypto.createCipheriv('aes-256-gcm', referenceKey(password, salt), nonce);
  cipher.setAAD(AAD);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return JSON.stringify({
    version: 1, salt: salt.toString('base64'), content: Buffer.concat([nonce, body]).toString('base64'),
  });
}
function referenceDecrypt(exported: string, password: string): string {
  const doc = JSON.parse(exported);
  const sealed = Buffer.from(doc.content, 'base64');
  const decipher = nodeCrypto.createDecipheriv(
    'aes-256-gcm', referenceKey(password, Buffer.from(doc.salt, 'base64')), sealed.subarray(0, 12));
  decipher.setAAD(AAD);
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  return Buffer.concat([decipher.update(sealed.subarray(12, sealed.length - 16)), decipher.final()]).toString('utf8');
}

describe('plain export', () => {
  it('imports every entry with its id, names and note', async () => {
    const { accounts, errors } = await importExport(PLAIN);
    expect(errors).toEqual([]);
    expect(accounts).toHaveLength(3);
    expect(accounts[0]).toMatchObject({
      id: '0b5c7d0e-6a7b-4a35-9d0c-0b1f7a3c2e11', kind: 'totp', issuer: 'GitHub', label: 'octo@example.com',
      secret: 'JBSWY3DPEHPK3PXP', note: 'work account',
    });
    expect(accounts[1]).toMatchObject({ issuer: 'Example Corp', label: '', algorithm: 'SHA256', digits: 8, period: 60 });
    expect(accounts[2]).toMatchObject({ kind: 'steam', issuer: 'Steam', label: 'gamer' });
    expect(generateCode(accounts[1], 119)).toBe('46119246');
    expect(generateCode(accounts[2], 1742298317)).toBe('VKFDN');
  });

  it('round-trips byte for byte', async () => {
    const { accounts } = await importExport(PLAIN);
    expect(exportPlain(accounts)).toBe(PLAIN);
  });

  it('reports a bad entry and still imports the rest', async () => {
    const doc = JSON.parse(PLAIN);
    doc.entries[0].content.uri = 'otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP';
    const { accounts, errors } = await importExport(JSON.stringify(doc));
    expect(accounts).toHaveLength(2);
    expect(errors).toEqual([expect.stringMatching(/^octo@example.com: .*HOTP/)]);
  });

  it.each([['not json', /not JSON/], ['[]', /not a Proton/], ['{"version":2,"entries":[]}', /version/], ['{"version":1}', /not a Proton/]])(
    'rejects %s', async (text, message) => {
      await expect(importExport(text)).rejects.toThrow(message);
    });
});

describe('password-protected export', () => {
  it('imports a file encrypted the way Proton does', async () => {
    const encrypted = referenceEncrypt(PLAIN, PASSWORD);
    expect(isEncryptedExport(encrypted)).toBe(true);
    expect(isEncryptedExport(PLAIN)).toBe(false);
    const { accounts, errors } = await importExport(encrypted, PASSWORD);
    expect(errors).toEqual([]);
    expect(exportPlain(accounts)).toBe(PLAIN);
  });

  it('writes a file Proton can decrypt', async () => {
    const { accounts } = await importExport(PLAIN);
    const encrypted = await exportEncrypted(accounts, PASSWORD);
    expect(referenceDecrypt(encrypted, PASSWORD)).toBe(PLAIN);
    expect(Buffer.from(JSON.parse(encrypted).salt, 'base64')).toHaveLength(16);
  });

  it('asks for a password, and rejects the wrong one', async () => {
    const encrypted = referenceEncrypt(PLAIN, PASSWORD);
    await expect(importExport(encrypted)).rejects.toBeInstanceOf(PasswordRequired);
    await expect(importExport(encrypted, 'wrong')).rejects.toBeInstanceOf(BadPassword);
  });
});

describe('mergeAccounts', () => {
  it('skips entries already present by id or by secret', async () => {
    const { accounts } = await importExport(PLAIN);
    const again = accounts.map((a, i) => (i === 0 ? { ...a, id: 'different-id' } : a));
    const extra = { ...accounts[0], id: 'new', secret: 'GEZDGNBVGY3TQOJQ' };
    const { merged, added } = mergeAccounts(accounts, [...again, extra]);
    expect(added).toBe(1);
    expect(merged).toHaveLength(4);
  });
});
