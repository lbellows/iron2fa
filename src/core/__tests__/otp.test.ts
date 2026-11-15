import { generateCode, parseUri, secondsRemaining, Account } from '../otp';

// RFC 6238 Appendix B. The seeds are the ASCII strings "1234567890..." of 20,
// 32 and 64 bytes, base32-encoded.
const SEEDS = {
  SHA1: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
  SHA256: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA',
  SHA512:
    'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA',
} as const;

const VECTORS: [number, string, string, string][] = [
  [59, '94287082', '46119246', '90693936'],
  [1111111109, '07081804', '68084774', '25091201'],
  [1111111111, '14050471', '67062674', '99943326'],
  [1234567890, '89005924', '91819424', '93441116'],
  [2000000000, '69279037', '90698825', '38618901'],
  [20000000000, '65353130', '77737706', '47863826'],
];

function totp(algorithm: keyof typeof SEEDS, digits = 8): Account {
  return { id: 'x', kind: 'totp', issuer: '', label: '', secret: SEEDS[algorithm], algorithm, digits, period: 30, note: '' };
}

describe('generateCode', () => {
  it.each(VECTORS)('matches RFC 6238 at t=%d', (time, sha1, sha256, sha512) => {
    expect(generateCode(totp('SHA1'), time)).toBe(sha1);
    expect(generateCode(totp('SHA256'), time)).toBe(sha256);
    expect(generateCode(totp('SHA512'), time)).toBe(sha512);
  });

  it('truncates to six digits, keeping leading zeros', () => {
    expect(generateCode(totp('SHA1', 6), 59)).toBe('287082');
    expect(generateCode(totp('SHA1', 6), 1111111109)).toBe('081804');
  });

  // Vectors from Proton's own tests (proton-authenticator/src/steam/mod.rs).
  it('generates Steam codes', () => {
    expect(generateCode(parseUri('steam://STEAMKEY'), 1742298317)).toBe('VKFDN');
    expect(generateCode(parseUri('steam://77776ERUKZ4JVPG66AISEM2EKVTHPCEZ'), 1700000000)).toBe('64YGY');
  });

  it('reads a Steam secret typed in lowercase as base32, not base64', () => {
    expect(generateCode(parseUri('steam://77776erukz4jvpg66aisem2ekvthpcez'), 1700000000)).toBe('64YGY');
    expect(generateCode(parseUri('steam://7777 6eru kz4j vpg6 6ais em2e kvth pcez'), 1700000000)).toBe('64YGY');
  });

  it('keeps a base64 Steam secret whole when it contains a slash', () => {
    const secret = 'ABEiM0RVZneImaq7zN3u/z//f/8=';
    expect(parseUri(`steam://${secret}`).secret).toBe(secret);
    expect(parseUri('steam://+/8RIjNEVWZ3iJmqu8zd7v8AESI=').secret).toBe('+/8RIjNEVWZ3iJmqu8zd7v8AESI=');
  });

  it('counts down within the period', () => {
    expect(secondsRemaining(totp('SHA1'), 60)).toBe(30);
    expect(secondsRemaining(totp('SHA1'), 89)).toBe(1);
  });
});

describe('parseUri', () => {
  it('reads issuer, label and defaults', () => {
    const a = parseUri('otpauth://totp/GitHub:octo%40example.com?secret=jbsw y3dp-ehpk3pxp&issuer=GitHub');
    expect(a).toMatchObject({
      kind: 'totp', issuer: 'GitHub', label: 'octo@example.com', secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1', digits: 6, period: 30,
    });
  });

  it('takes the issuer from the label when there is no issuer parameter', () => {
    expect(parseUri('otpauth://totp/Acme%3Abob?secret=JBSWY3DPEHPK3PXP')).toMatchObject({ issuer: 'Acme', label: 'bob' });
  });

  it('keeps the whole label when its prefix is not the issuer', () => {
    expect(parseUri('otpauth://totp/team:bob?secret=JBSWY3DPEHPK3PXP&issuer=Acme')).toMatchObject({
      issuer: 'Acme', label: 'team:bob',
    });
  });

  it('reads non-default parameters', () => {
    expect(parseUri('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=sha512&digits=8&period=60')).toMatchObject({
      algorithm: 'SHA512', digits: 8, period: 60,
    });
  });

  it.each([
    ['https://example.com', /otpauth/],
    ['otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1', /HOTP/],
    ['otpauth://totp/x?issuer=nosecret', /no secret/],
    ['otpauth://totp/x?secret=not!base32', /base32/],
    ['otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=MD5', /algorithm/],
    ['otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=0', /digits/],
    ['otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&period=0', /period/],
  ])('rejects %s', (uri, message) => {
    expect(() => parseUri(uri)).toThrow(message);
  });
});
