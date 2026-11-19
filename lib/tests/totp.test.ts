// RFC 6238 Appendix B vectors (eight digits, the three hashes), the defaults, otpauth parameters, the wait near the end of a window, and what is and is not a seed.
import test from "node:test";
import assert from "node:assert/strict";
import { codeAt, codeAtStep, codeToType, decodeBase32, isSeedField, parseSeed } from "../totp.ts";

const b32 = (b: Buffer): string => {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0,
    val = 0,
    out = "";
  for (const byte of b) {
    val = (val << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += A[(val >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += A[(val << (5 - bits)) & 31];
  return out;
};
// the RFC's keys: the ASCII digits 1234567890 repeated, 20, 32 and 64 bytes long
const key = (n: number): string => b32(Buffer.from("1234567890".repeat(7).slice(0, n)));
const SHA1 = key(20);
const SHA256 = key(32);
const SHA512 = key(64);
const at = (algo: string, secret: string, t: number) =>
  codeAt(parseSeed(`otpauth://totp/x?secret=${secret}&algorithm=${algo}&digits=8`)!, t * 1000).code;

test("the RFC 6238 test vectors, for SHA1, SHA256 and SHA512", () => {
  const rows: [number, string, string, string][] = [
    [59, "94287082", "46119246", "90693936"],
    [1111111109, "07081804", "68084774", "25091201"],
    [1111111111, "14050471", "67062674", "99943326"],
    [1234567890, "89005924", "91819424", "93441116"],
    [2000000000, "69279037", "90698825", "38618901"],
    [20000000000, "65353130", "77737706", "47863826"],
  ];
  for (const [t, s1, s256, s512] of rows) {
    assert.equal(at("SHA1", SHA1, t), s1, `SHA1 at ${t}`);
    assert.equal(at("SHA256", SHA256, t), s256, `SHA256 at ${t}`);
    assert.equal(at("SHA512", SHA512, t), s512, `SHA512 at ${t}`);
  }
});

test("a plain base32 seed is SHA1, 6 digits, 30 seconds; an otpauth address brings its own digits and period", () => {
  const p = parseSeed("gezd gnbv-gy3t qojq gezd gnbv gy3t qojq")!;
  assert.deepEqual([p.algorithm, p.digits, p.period], ["SHA1", 6, 30]);
  assert.equal(codeAtStep(p, 1), "287082", "the RFC's step 1 code, last six digits");
  const q = parseSeed(`otpauth://totp/Acme:dana?secret=${SHA1}&issuer=Acme&digits=7&period=60`)!;
  assert.deepEqual([q.digits, q.period], [7, 60]);
  assert.equal(codeAt(q, 59_000).leftMs, 1000);
  assert.equal(codeAt(q, 59_000).code.length, 7);
});

test("what is not a seed is refused: not base32, a wrong scheme, a bad algorithm, digits or period", () => {
  for (const bad of [
    "",
    "not base32 !!",
    "otpauth://hotp/x?secret=" + SHA1,
    `otpauth://totp/x?secret=${SHA1}&algorithm=MD5`,
    `otpauth://totp/x?secret=${SHA1}&digits=12`,
    `otpauth://totp/x?secret=${SHA1}&period=1`,
    "otpauth://totp/x",
  ])
    assert.equal(parseSeed(bad), null, bad);
  assert.equal(decodeBase32("1"), null);
});

test("with fewer than five seconds left in the window the next window's code is typed, after a wait; otherwise now", () => {
  const seed = SHA1;
  const mid = codeToType(seed, 10_000)!; // 20 s left
  assert.equal(mid.waitMs, 0);
  const late = codeToType(seed, 27_000)!; // 3 s left
  assert.equal(late.waitMs, 3000);
  const next = codeToType(seed, 30_000)!;
  assert.equal(late.code, next.code, "the code of the window it waits for");
  assert.equal(codeToType(seed, 25_000)!.waitMs, 0, "exactly five seconds left is enough");
  assert.equal(codeToType(seed, 25_001)!.waitMs, 4999);
  assert.equal(codeToType("nonsense !!", 0), null);
});

test("a seed field is an item of the kind totp, or a field named like one; a password or a code is not", () => {
  assert.equal(isSeedField("totp", "secret"), true);
  for (const key of ["totp", "TOTP", "otp", "totp_secret", "otpauth", "2fa", "mfa"])
    assert.equal(isSeedField("login", key), true, key);
  for (const key of ["password", "username", "code", "pin"]) assert.equal(isSeedField("login", key), false, key);
});
