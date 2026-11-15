import { mergeAccounts, needsPassword, readBackup, writeBackup } from '../backup';
import { Account } from '../otp';
import { BadPassword, PasswordRequired } from '../proton';

// Accounts Proton's format cannot carry: a label with a colon and no issuer, a
// renamed Steam account, a base64 Steam secret with slashes.
const accounts: Account[] = [
  { id: 'a', kind: 'totp', issuer: '', label: 'work:me@example.com', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA256', digits: 8, period: 60, note: 'n ✓' },
  { id: 'b', kind: 'steam', issuer: 'Steam alt', label: 'me', secret: 'ABEiM0RVZneImaq7zN3u/z//f/8=', algorithm: 'SHA1', digits: 5, period: 30, note: '' },
];
const PASSWORD = 'correct horse battery ✓';
const PROTON = JSON.stringify({
  version: 1,
  entries: [{ id: 'p', content: { uri: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&issuer=GitHub', entry_type: 'Totp', name: 'x' }, note: null }],
});

describe('Iron2FA backup', () => {
  it('reads back exactly what was written, plain', async () => {
    const text = await writeBackup(accounts);
    expect(needsPassword(text)).toBe(false);
    expect(await readBackup(text)).toEqual({ accounts, errors: [] });
  });

  it('reads back exactly what was written, encrypted', async () => {
    const text = await writeBackup(accounts, PASSWORD);
    expect(needsPassword(text)).toBe(true);
    expect(text).not.toContain('JBSWY3DPEHPK3PXP');
    expect(await readBackup(text, PASSWORD)).toEqual({ accounts, errors: [] });
  });

  it('asks for a password, and rejects the wrong one', async () => {
    const text = await writeBackup(accounts, PASSWORD);
    await expect(readBackup(text)).rejects.toBeInstanceOf(PasswordRequired);
    await expect(readBackup(text, 'wrong')).rejects.toBeInstanceOf(BadPassword);
  });

  it('reports a bad entry and still reads the rest', async () => {
    const doc = JSON.parse(await writeBackup(accounts));
    doc.accounts[0].secret = 'not base32!';
    doc.accounts.push({ id: 'c', kind: 'hotp' });
    const { accounts: read, errors } = await readBackup(JSON.stringify(doc));
    expect(read).toEqual([accounts[1]]);
    expect(errors).toEqual([expect.stringMatching(/^work:me@example.com: /), expect.stringMatching(/^entry 3: /)]);
  });

  it('refuses a newer format and unreasonable key-derivation settings', async () => {
    await expect(readBackup('{"format":"iron2fa","version":2,"accounts":[]}')).rejects.toThrow(/newer version/);
    const doc = JSON.parse(await writeBackup(accounts, PASSWORD));
    doc.kdf.m = 64 * 1024 * 1024;
    await expect(readBackup(JSON.stringify(doc), PASSWORD)).rejects.toThrow(/key-derivation/);
  });

  it('still reads a Proton Authenticator export', async () => {
    expect(needsPassword(PROTON)).toBe(false);
    const { accounts: read, errors } = await readBackup(PROTON);
    expect(errors).toEqual([]);
    expect(read).toEqual([expect.objectContaining({ id: 'p', issuer: 'GitHub', label: 'x' })]);
  });
});

describe('mergeAccounts', () => {
  it('skips an account already present by id', () => {
    expect(mergeAccounts(accounts, [{ ...accounts[0], secret: 'GEZDGNBVGY3TQOJQ' }]).added).toBe(0);
  });

  it('skips the same secret under another id and name, however it is written', () => {
    const renamed = { ...accounts[0], id: 'z', issuer: 'Other', label: 'other', secret: 'jbsw y3dp ehpk 3pxp' };
    expect(mergeAccounts(accounts, [renamed])).toEqual({ merged: accounts, added: 0 });
  });

  it('adds a new secret, and the same secret once', () => {
    const extra = { ...accounts[0], id: 'n1', secret: 'GEZDGNBVGY3TQOJQ' };
    const { merged, added } = mergeAccounts(accounts, [extra, { ...extra, id: 'n2' }]);
    expect(added).toBe(1);
    expect(merged).toEqual([...accounts, extra]);
  });

  it('treats the same key with different code settings as different accounts', () => {
    expect(mergeAccounts(accounts, [{ ...accounts[0], id: 'd', digits: 6 }]).added).toBe(1);
  });
});
