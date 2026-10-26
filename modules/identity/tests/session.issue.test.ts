// P-SEC_05: sign-in and pairing open a per-device session the gateway honors. The module registers the device through devices.register and the host mints the token for that session, so a person who
// just joined can use the app; signing out, or revoking the device, ends exactly that session and no other. The first half is the module with the host's two seams faked; the second is a booted
// daemon with the identity and devices modules live, signing in through the gateway with real tokens (rule 27), with a refusal for a stale token and for a server with no session seam.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootCore } from "../../../fixtures/seed/core/index.ts";
import type { CapabilityDef } from "../../../packages/contracts/src/types.ts";
import { fakePlatform } from "../../../host/src/platform/index.ts";
import type { FetchFn } from "../../../host/src/platform/probes.ts";
import { loadConfig } from "../../../host/src/daemon/config.ts";
import { startDaemon } from "../../../host/src/daemon/daemon.ts";
import type { Daemon } from "../../../host/src/daemon/daemon.ts";
import { issueSessionToken } from "../../../host/src/daemon/session.ts";
import { handlers } from "../handlers/index.ts";
import { configureSessionTokens, makeVerifier, provisionAccount } from "../projections.ts";
import type { IdentityCtx } from "../projections.ts";
import { codeOf, DEVICE, harness } from "./wire.ts";

afterEach(() => configureSessionTokens(null));

const SECRET = "correct horse battery staple";

async function maya(h: ReturnType<typeof harness>): Promise<void> {
  await provisionAccount(h.anon, { personId: "usr_maya", username: "maya", name: "Maya", secret: SECRET });
}

test("sign-in registers the device through devices.register, mints the token for that session, and sign-out ends only that session at the gateway", async () => {
  const h = harness();
  await maya(h);
  const a = await handlers["identity.sign_in"](h.anon, { username: "maya", password: SECRET, ...DEVICE });
  const b = await handlers["identity.sign_in"](h.anon, { username: "maya", password: SECRET, deviceName: "Phone", deviceClass: "phone" });
  assert.deepEqual(h.registered.map((r) => [r.person, r.name, r.class]), [["usr_maya", "Maya's Mac", "desktop"], ["usr_maya", "Phone", "phone"]]);
  assert.match(a.session!.sessionId, /^ses_w/, "the session is the devices session");
  assert.notEqual(a.session!.sessionId, b.session!.sessionId);
  await handlers["identity.sign_out"](h.as("usr_maya", { id: a.session!.sessionId, deviceId: a.session!.deviceId }), {});
  assert.deepEqual(h.ended, [a.session!.sessionId], "the gateway session of this device only");
});

test("pairing a device opens its own session through the same path", async () => {
  const h = harness();
  await maya(h);
  const code = await handlers["identity.pair_create"](h.as("usr_maya"), { purpose: "app" });
  const out = await handlers["identity.pair_redeem"](h.anon, { code: code.code, ...DEVICE });
  assert.ok(out.session && h.registered.length === 1 && out.session.sessionId.startsWith("ses_w"));
});

test("without the host's session seam, sign-in refuses and signs nobody in (fail closed)", async () => {
  const h = harness();
  await maya(h);
  configureSessionTokens(null);
  await assert.rejects(handlers["identity.sign_in"](h.anon, { username: "maya", password: SECRET, ...DEVICE }), (e) => codeOf(e) === "internal.unavailable");
  assert.deepEqual(h.registered, []);
  assert.equal((h.db.all(`SELECT id FROM identity_sessions`) as unknown[]).length, 0);
});

// ---- booted

const whoCap = {
  name: "example.whoami", v: 1, permission: null, level: "view", resource: { type: "space" }, idempotency: "natural", effects: "read", risk: "low", emits: [],
  examples: [], surfaces: {}, input: {}, output: {}, errors: [], summary: "Who the gateway says is calling",
} as unknown as CapabilityDef;
const whoRoute = { method: "POST", path: "/v1/example/whoami", cap: "example.whoami", v: 1, effects: "read" as const };
const whoHandler = (ctx: { device?: string; principal: { id: string } }): unknown => ({ device: ctx.device ?? null, person: ctx.principal.id });
const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

/** A code root that is this repo with the identity and devices modules live (the flip itself waits for P-CI_02, ruling 25). */
function codeRootWithLive(ids: string[]): string {
  const repo = fileURLToPath(new URL("../../..", import.meta.url));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-coderoot-"));
  for (const name of fs.readdirSync(repo)) if (name !== ".git" && name !== "host") fs.symlinkSync(path.join(repo, name), path.join(root, name));
  fs.mkdirSync(path.join(root, "host"));
  for (const name of fs.readdirSync(path.join(repo, "host"))) if (name !== "modules.json") fs.symlinkSync(path.join(repo, "host", name), path.join(root, "host", name));
  const list = JSON.parse(fs.readFileSync(path.join(repo, "host/modules.json"), "utf8")) as { modules: { id: string; status: string }[] };
  for (const id of ids) {
    const m = list.modules.find((x) => x.id === id);
    assert.ok(m, `host/modules.json lists ${id}`);
    m.status = "live";
  }
  fs.writeFileSync(path.join(root, "host/modules.json"), JSON.stringify(list));
  return root;
}

const post = (d: Daemon, p: string, token: string | null, body: unknown) => fetch(`${d.url}${p}`, {
  method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
});
const who = async (d: Daemon, token: string | null): Promise<{ status: number; person?: string; device?: string | null }> => {
  const r = await post(d, "/v1/example/whoami", token, {});
  if (r.status !== 200) return { status: r.status };
  const data = ((await r.json()) as { data: { person: string; device: string | null } }).data;
  return { status: 200, person: data.person, device: data.device };
};

test("booted: a person who has just joined signs in on two devices, both tokens work at the gateway, signing one out or revoking it ends only that one, and a stale token gets 401", async () => {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-session-issue-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: codeRootWithLive(["identity", "devices"]),
    platform: fakePlatform({
      os: "linux", hostname: "session-issue", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    extra: { caps: [whoCap], routes: [whoRoute], handlers: { "example.whoami": whoHandler as never, "sync.epoch.bump": (() => ({ epoch: 1 })) as never } },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, tick: 3_600_000, hooks: 3_600_000 },
  });
  try {
    // no configureSessionTokens here: the daemon wires identity's setSessionTokens seam at boot, and that is what this proves
    // the joined member: an account row, as the invite accept leaves it
    const ctx = { space: "spc_core", trace: { traceId: "t".repeat(32) }, now: () => Date.now(), db: d.db, emit: () => undefined } as unknown as IdentityCtx;
    await provisionAccount(ctx, { personId: "usr_noah", username: "joined", name: "Joined Member", secret: SECRET });
    assert.ok(await makeVerifier(SECRET));

    const signIn = async (deviceName: string, deviceClass: string) => {
      const r = await post(d, "/v1/identity/sign_in", null, { username: "joined", password: SECRET, deviceName, deviceClass });
      assert.equal(r.status, 200, JSON.stringify(await r.clone().json()).slice(0, 300));
      return ((await r.json()) as { data: { session: { sessionId: string; deviceId: string; token: string } } }).data.session;
    };
    const mac = await signIn("Mac", "desktop");
    const phone = await signIn("Phone", "phone");
    assert.notEqual(mac.deviceId, phone.deviceId);

    assert.deepEqual(await who(d, mac.token), { status: 200, person: "usr_noah", device: mac.deviceId }, "the new member's token works at the gateway");
    assert.deepEqual(await who(d, phone.token), { status: 200, person: "usr_noah", device: phone.deviceId });
    assert.equal((await who(d, null)).status, 401);
    assert.equal((await who(d, "vst_" + "0".repeat(64))).status, 401, "an unknown token is refused");

    // sign the phone out: only the phone stops
    const out = await post(d, "/v1/identity/sign_out", phone.token, {});
    assert.equal(out.status, 200, JSON.stringify(await out.clone().json()).slice(0, 300));
    assert.equal((await who(d, phone.token)).status, 401, "a signed-out token is stale");
    assert.equal((await who(d, mac.token)).status, 200, "the other device keeps working");

    // a third device, revoked from the Mac: only that device stops
    const tablet = await signIn("Tablet", "phone");
    assert.equal((await who(d, tablet.token)).status, 200);
    const revoked = await post(d, "/v1/devices/revoke", mac.token, { deviceId: tablet.deviceId });
    assert.equal(revoked.status, 200, JSON.stringify(await revoked.clone().json()).slice(0, 300));
    assert.equal((await who(d, tablet.token)).status, 401, "a revoked device is cut off");
    assert.equal((await who(d, mac.token)).status, 200, "and the device that revoked it is not");

    // a server with no session seam signs nobody in
    configureSessionTokens(null);
    assert.equal((await post(d, "/v1/identity/sign_in", null, { username: "joined", password: SECRET, deviceName: "X", deviceClass: "web" })).status, 503);
  } finally { await d.stop(); }
});
