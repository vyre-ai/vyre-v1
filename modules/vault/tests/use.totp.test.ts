// A one-time-code seed is never filled or read out: its current code is (RFC 6238, the algorithm, digits and period the seed names), with at least five seconds of the window left. The seed stays in the Vault;
// it is in no sink, answer, event, row or log. Reads through the port (the engine and agent computers) come out as the code too.
// @reads /modules/vault/handlers/use.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as v from "../handlers/index.ts";
import * as u from "../handlers/use.ts";
import { codeAt, codeToType, parseSeed } from "../../../lib/totp.ts";
import { MAYA, harness, refusedWith } from "../fixtures/harness.ts";
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
  const h = harness();
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
  const h = harness();
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
  const h = harness();
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
  const h = harness();
  const got = sink();
  await put(h, "Broken TOTP", "totp", [{ key: "secret", value: "this is not base32 !!" }]);
  assert.equal(
    await refusedWith(u.fill(h.ctx, { handle: "#Broken_TOTP", target: { kind: "env", ref: "r" } })),
    "validation.bad_input",
  );
  assert.deepEqual(got, []);
});

test("the Vault port, which the engine and agent computers read through, hands out the code of a seed and never the seed", async () => {
  const h = harness();
  await put(h, "Port TOTP", "totp", [{ key: "secret", value: SEED }]);
  const port = u.secretPort(h.ctx.db);
  const before = Date.now();
  const got = await port.secret("#Port_TOTP", "", MAYA).catch(() => port.secret("#Port_TOTP", ""));
  assert.match(got, /^\d{6}$/);
  assert.notEqual(got, SEED);
  const p = parseSeed(SEED)!;
  const ok = [before, Date.now(), Date.now() + 30_000].some((t) => codeAt(p, t).code === got);
  assert.ok(ok, "the current (or the next window's) code");
});
