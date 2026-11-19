// A one-time-code seed is never filled or read out: its current code is (RFC 6238, the algorithm, digits and period the seed names), with at least five seconds of the window left. The seed stays in the Vault;
// it is in no sink, answer, event, row or log. Reads through the port (the engine and agent computers) come out as the code too.
// @reads /modules/vault/handlers/use.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as v from "../handlers/index.ts";
import * as u from "../handlers/use.ts";
import { codeAt, codeToType, parseSeed } from "../../../lib/totp.ts";
import { AGENT, MAYA, harness, refusedWith } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
const out = (x: unknown): Json => x as Json;
let seq = 0;
const key = (): string => `t-${++seq}`;
const SEED = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"; // secret-scan: fake
const OTPAUTH = `otpauth://totp/Acme:dana?secret=${SEED}&issuer=Acme&algorithm=SHA256&digits=8&period=60`; // secret-scan: fake

async function folder(h: Harness): Promise<string> {
  return String(
    out(out(await v.foldersCreate(h.ctx, { name: `shared ${key()}`, scope: "shared", idempotencyKey: key() })).folder)
      .id,
  );
}
async function put(h: Harness, name: string, kind: string, fields: { key: string; value: string }[]): Promise<void> {
  await v.itemPut(h.ctx, { folderId: await folder(h), name, kind, fields, idempotencyKey: key() } as Parameters<
    typeof v.itemPut
  >[1]);
}
/** A harness whose clock is the one the codes are made on (the fill and the port share it), with the per-item limit cleared. */
function clocked(): Harness {
  const h = harness();
  u.resetCodeLimit();
  u.setTotpClock(() => h.ctx.now());
  return h;
}
function sink() {
  const got: { value: string; field: string }[] = [];
  u.configureVault({ sinks: { env: (f: { value: string; field: string }) => void got.push(f) } });
  return got;
}
/** Where the harness clock stands in its 30 second window: move it to `leftMs` before the next window starts. */
function windowLeft(h: Harness, periodS: number, leftMs: number): void {
  const periodMs = periodS * 1000;
  const into = h.ctx.now() % periodMs;
  h.advance((((periodMs - leftMs - into) % periodMs) + periodMs) % periodMs);
}

test("filling a totp item gives the current code, not the seed: nothing of the seed reaches the sink, the answer, an event, a row or a log", async () => {
  const h = clocked();
  const got = sink();
  u.setTotpSleep(async () => undefined);
  try {
    await put(h, "Acme TOTP", "totp", [{ key: "secret", value: SEED }]);
    windowLeft(h, 30, 20_000);
    const r = out(await u.fill(h.ctx, { handle: "#Acme_TOTP", target: { kind: "env", ref: "ref-1" } }));
    assert.equal(r.filled, true);
    const expected = codeAt(parseSeed(SEED)!, h.ctx.now()).code;
    assert.deepEqual(
      got.map((g) => g.value),
      [expected],
    );
    assert.match(got[0]!.value, /^\d{6}$/);
    assert.ok(!JSON.stringify(r).includes(SEED) && !h.everything().includes(SEED), "the seed is nowhere");
  } finally {
    u.setTotpSleep(null);
  }
});

test("a login's totp field is a seed too; the code follows the otpauth algorithm, digits and period; a person asking for the value back gets the code", async () => {
  const h = clocked();
  const got = sink();
  await put(h, "Acme Login", "login", [
    { key: "username", value: "dana" },
    { key: "password", value: "pw-not-a-seed" },
    { key: "totp", value: OTPAUTH },
  ]);
  windowLeft(h, 60, 30_000);
  const r = out(
    await u.fill(h.ctx, { handle: "#Acme_Login.totp", target: { kind: "env", ref: "ref-2" }, returnValue: true }),
  );
  const expected = codeAt(parseSeed(OTPAUTH)!, h.ctx.now()).code;
  assert.equal(expected.length, 8);
  assert.deepEqual([got[0]!.value, r.value], [expected, expected]);
  // a password beside it is still filled as typed
  await u.fill(h.ctx, { handle: "#Acme_Login.password", target: { kind: "env", ref: "ref-3" } });
  assert.equal(got[1]!.value, "pw-not-a-seed");
  assert.ok(!h.everything().includes(SEED));
});

test("with fewer than five seconds left in the window the next window's code is typed, after waiting for it", async () => {
  const h = clocked();
  const got = sink();
  const waited: number[] = [];
  u.setTotpSleep(async (ms) => void waited.push(ms));
  try {
    await put(h, "Late TOTP", "totp", [{ key: "secret", value: SEED }]);
    windowLeft(h, 30, 3000);
    const now = h.ctx.now();
    await u.fill(h.ctx, { handle: "#Late_TOTP", target: { kind: "env", ref: "r" } });
    assert.deepEqual(waited, [3000]);
    assert.equal(got[0]!.value, codeAt(parseSeed(SEED)!, now + 3000).code, "the next window's code");
    assert.notEqual(got[0]!.value, codeAt(parseSeed(SEED)!, now).code);
    windowLeft(h, 30, 5000);
    waited.length = 0;
    await u.fill(h.ctx, { handle: "#Late_TOTP", target: { kind: "env", ref: "r2" } });
    assert.deepEqual(waited, [], "five seconds left is enough");
    assert.equal(codeToType(SEED, h.ctx.now())!.waitMs, 0);
  } finally {
    u.setTotpSleep(null);
  }
});

test("an item whose secret is not a seed refuses with words and fills nothing", async () => {
  const h = clocked();
  const got = sink();
  await put(h, "Broken TOTP", "totp", [{ key: "secret", value: "this is not base32 !!" }]);
  assert.equal(
    await refusedWith(u.fill(h.ctx, { handle: "#Broken_TOTP", target: { kind: "env", ref: "r" } })),
    "validation.bad_input",
  );
  assert.deepEqual(got, []);
});

test("the Vault port, which the engine and agent computers read through, hands out the code of a seed and never the seed, on the same clock as a fill", async () => {
  const h = clocked();
  await put(h, "Port TOTP", "totp", [{ key: "secret", value: SEED }]);
  windowLeft(h, 30, 20_000);
  const port = u.secretPort(h.ctx.db);
  const got = await port.secret("#Port_TOTP", "", MAYA).catch(() => port.secret("#Port_TOTP", ""));
  assert.match(got, /^\d{6}$/);
  assert.notEqual(got, SEED);
  assert.equal(
    got,
    codeAt(parseSeed(SEED)!, h.ctx.now()).code,
    "the code of the clock the fill uses (the harness's, not the wall clock)",
  );
  u.setTotpClock(null);
});

test("only a seed becomes a code: a recovery code kept under otp, 2fa or mfa, even one that looks like base32, is filled exactly as stored; an otpauth address in any field is a seed", async () => {
  const h = clocked();
  const got = sink();
  const BACKUP = "ABCDEFGH23456723"; // base32-looking, a recovery code
  await put(h, "Acme Recovery", "login", [
    { key: "otp", value: BACKUP },
    { key: "backup_2fa", value: "9F4K-2QXA-77BD" },
    { key: "mfa", value: "ABCDEFGH" },
    { key: "pin", value: "482913" },
    { key: "authenticator", value: OTPAUTH },
  ]);
  for (const field of ["otp", "backup_2fa", "mfa", "pin"])
    await u.fill(h.ctx, { handle: `#Acme_Recovery.${field}`, target: { kind: "env", ref: `r-${field}` } });
  assert.deepEqual(
    got.map((g) => g.value),
    [BACKUP, "9F4K-2QXA-77BD", "ABCDEFGH", "482913"],
    "stored values, as they are",
  );
  windowLeft(h, 60, 30_000);
  await u.fill(h.ctx, { handle: "#Acme_Recovery.authenticator", target: { kind: "env", ref: "r-oa" } });
  assert.equal(
    got[4]!.value,
    codeAt(parseSeed(OTPAUTH)!, h.ctx.now()).code,
    "an otpauth address is a seed whatever the field is called",
  );
});

test("an agent never has a code back: returnValue on a seed is refused for an agent, and a person still gets it", async () => {
  const h = clocked();
  sink();
  await put(h, "Agent TOTP", "totp", [{ key: "secret", value: SEED }]);
  windowLeft(h, 30, 20_000);
  // the agent's own item, so it may use it: the refusal is about the value coming back, not about access
  h.ctx.db.run(`UPDATE vault_meta SET "owner" = ? WHERE "name" = ?`, AGENT, "Agent TOTP");
  h.actAs("agent", AGENT);
  assert.equal(
    await refusedWith(u.fill(h.ctx, { handle: "#Agent_TOTP", target: { kind: "env", ref: "r" }, returnValue: true })),
    "permission.no_grant",
  );
  // the same agent may have the code typed (a sink fill)
  await u.fill(h.ctx, { handle: "#Agent_TOTP", target: { kind: "env", ref: "r1" } });
  h.ctx.db.run(`UPDATE vault_meta SET "owner" = ? WHERE "name" = ?`, MAYA, "Agent TOTP");
  h.actAs("person", MAYA);
  const r = out(await u.fill(h.ctx, { handle: "#Agent_TOTP", target: { kind: "env", ref: "r2" }, returnValue: true }));
  assert.equal(r.value, codeAt(parseSeed(SEED)!, h.ctx.now()).code);
});

test("every code made is its own use with its own event (item, field, kind of place, who), never the code; six per item per ten minutes per actor", async () => {
  const h = clocked();
  const got = sink();
  await put(h, "Busy TOTP", "totp", [{ key: "secret", value: SEED }]);
  windowLeft(h, 30, 20_000);
  for (let i = 0; i < 6; i++) await u.fill(h.ctx, { handle: "#Busy_TOTP", target: { kind: "env", ref: `r${i}` } });
  const used = h.named("vault.used");
  assert.equal(used.length, 6, "one event for each code");
  assert.ok(used.every((e) => e.payload["purpose"] === "one-time code, env" && e.payload["field"] === "secret"));
  assert.ok(
    used.every((e) => !("value" in e.payload) && !JSON.stringify(e.payload).includes(got[0]!.value)),
    "no event carries the code",
  );
  assert.equal(
    await refusedWith(u.fill(h.ctx, { handle: "#Busy_TOTP", target: { kind: "env", ref: "r7" } })),
    "validation.bad_input",
    "the seventh is refused",
  );
  assert.equal(got.length, 6, "and nothing was filled for it");
  h.actAs("person", "usr_rob");
  h.advance(11 * 60_000);
  h.actAs("person", MAYA);
  windowLeft(h, 30, 20_000);
  await u.fill(h.ctx, { handle: "#Busy_TOTP", target: { kind: "env", ref: "r8" } });
  assert.equal(got.length, 7, "ten minutes later it works again");
});
