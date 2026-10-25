// P-SEC_03: a booted daemon resolves every bearer token to a device session. The device id comes from that session, never from the x-vyre-device header or ?device=; a revoked
// device gets 401 on HTTP and on the live socket; its sibling keeps working; devices.revoke tells sync (sync.epoch.bump, device_revoked) so the revoked replica purges.
// Everything goes through the real gateway and the real upgrade handler with real tokens. The devices module is still a stub in host/modules.json (flip: P-CI_02, ruling 25), so the test
// serves its REAL handlers (modules/devices/impl.ts) and the REAL sync purge handlers (modules/sync/handlers/purge.ts) through `extra.handlers`; the pipeline, authorization, ctx.call and ctx.db are the daemon's.
// The two devices and their sessions are fixture rows (what sign-in will write); their tokens are minted with issueSessionToken.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { AccessSnapshot } from "../../kernel/src/authorize/index.ts";
import { handlers as devicesHandlers } from "../../modules/devices/impl.ts";
import { openSync } from "../../modules/sync/impl.ts";
import { createPurgeHandlers, purgeDepsOf, toPurgeCtx } from "../../modules/sync/handlers/purge.ts";
import { effectiveEpoch } from "../../sync/src/purge/index.ts";
import { payloadOf } from "../../kernel/src/store/projection.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import { ADMIN_DEVICE, issueSessionToken } from "../src/daemon/session.ts";
import type { Handler } from "../src/invoke.ts";

const whoCap = {
  name: "example.whoami", v: 1, permission: null, level: "view", resource: { type: "space" }, idempotency: "natural", effects: "read", risk: "low", emits: [],
  examples: [], surfaces: {}, input: {}, output: {}, errors: [], summary: "Who the gateway says is calling",
} as unknown as CapabilityDef;
const whoRoute = { method: "POST", path: "/v1/example/whoami", cap: "example.whoami", v: 1, effects: "read" as const };
const whoHandler = (ctx: { device?: string; principal: { id: string } }): unknown => ({ device: ctx.device ?? null, person: ctx.principal.id });

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-session-revoke-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const call = (d: Daemon, p: string, token: string | null, body: unknown, extra: Record<string, string> = {}) => fetch(`${d.url}${p}`, {
  method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra }, body: JSON.stringify(body),
});
const whoami = async (d: Daemon, token: string | null, extra: Record<string, string> = {}): Promise<{ status: number; device?: string | null; person?: string }> => {
  const r = await call(d, "/v1/example/whoami", token, {}, extra);
  if (r.status !== 200) return { status: r.status };
  const data = ((await r.json()) as { data: { device: string | null; person: string } }).data;
  return { status: r.status, device: data.device, person: data.person };
};

/** Open the live socket the way a device does and report the HTTP status of the handshake: 101 when it upgrades, else the refusal. */
function live(d: Daemon, query: string, token?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1", port: d.port, path: `/sync/v1/ws?${query}`,
      headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64"), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    req.on("upgrade", (_res, socket) => { socket.destroy(); resolve(101); });
    req.on("response", (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on("error", reject);
    req.end();
  });
}

test("session: a token is its device; a forged header is ignored; revoking a device cuts it off on HTTP and the live socket, its sibling keeps working, and sync purges it", async () => {
  const dir = seededDir();
  // the real sync purge handlers over a real sync store; the hub counts what it was told to close
  const sync = openSync({ access: () => new AccessSnapshot() });
  const closed: string[] = [];
  const purge = createPurgeHandlers(purgeDepsOf(sync, { purge: () => 0, purgeDevice: (_p: string, device: string) => { closed.push(device); return 1; } }));
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "session-revoke", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    extra: {
      caps: [whoCap], routes: [whoRoute],
      handlers: {
        "example.whoami": whoHandler as never,
        "devices.revoke": devicesHandlers["devices.revoke"] as unknown as Handler,
        "sync.epoch.bump": ((ctx, input) => purge["sync.epoch.bump"](toPurgeCtx(ctx), input)) as Handler,
      },
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, tick: 3_600_000, hooks: 3_600_000 },
  });
  try {
    // the owner bootstrap path: the admin token acts as the owner on the fixed device, whatever the header says
    const admin = await whoami(d, d.token, { "x-vyre-device": "dev_forged" });
    assert.equal(admin.status, 200);
    assert.equal(admin.device, ADMIN_DEVICE, "the admin token never takes its device from the header");
    const person = admin.person!;

    const A = { device: "dev_a1b2c3", session: "ses_a1b2c3" }, B = { device: "dev_d4e5f6", session: "ses_d4e5f6" };
    const now = Date.now();
    for (const [x, name] of [[A, "Device A"], [B, "Device B"]] as const) {
      d.db!.run(`INSERT INTO devices_device (id, person, name, class, epoch, lastSeenAt, location, revokedAt, version, updated_at, deleted_at) VALUES (?, ?, ?, 'desktop', 0, ?, NULL, NULL, 0, ?, NULL)`, x.device, person, name, now, now);
      d.db!.run(`INSERT INTO devices_session (id, person, kind, principal_kind, device_id, started_at, last_seen_at, location, revoked_at) VALUES (?, ?, 'device', 'person', ?, ?, ?, NULL, NULL)`, x.session, person, x.device, now, now);
    }
    const tokA = issueSessionToken(d.db!, A.session), tokB = issueSessionToken(d.db!, B.session);

    // the device is the token's, not the caller's: a forged header and a forged query name another device and change nothing
    assert.deepEqual(await whoami(d, tokA), { status: 200, device: A.device, person });
    assert.deepEqual(await whoami(d, tokA, { "x-vyre-device": B.device }), { status: 200, device: A.device, person }, "a forged x-vyre-device header is ignored");
    assert.deepEqual(await whoami(d, tokB, { "x-vyre-device": A.device }), { status: 200, device: B.device, person });
    assert.equal(await live(d, `device=${B.device}`, tokA), 101, "A's live socket opens, and ?device= is not what names it");
    assert.equal(await live(d, `token=${tokB}`), 101, "B's live socket opens with the token in the query");

    // refusals: no token, an unknown token, a token for a session that does not exist, and the device id offered as the token
    assert.equal((await whoami(d, null)).status, 401);
    assert.equal((await whoami(d, "vst_" + "0".repeat(64))).status, 401, "an unknown token is refused");
    assert.equal((await whoami(d, issueSessionToken(d.db!, "ses_missing"))).status, 401, "a token whose session row is gone is refused");
    assert.equal((await whoami(d, A.device)).status, 401, "a device id is not a credential");
    assert.equal(await live(d, `token=${"vst_" + "0".repeat(64)}`), 401, "the live socket refuses an unknown token");
    assert.equal(await live(d, `device=${A.device}`), 401, "the live socket refuses a caller with a device name and no token");

    // B revokes A through the gateway
    const revoked = await call(d, "/v1/devices/revoke", tokB, { deviceId: A.device, idempotencyKey: "rev-a-1" });
    assert.equal(revoked.status, 200, JSON.stringify(await revoked.clone().json()).slice(0, 300));
    assert.deepEqual(((await revoked.json()) as { data: unknown }).data, { ok: true });

    // A: every HTTP call and the live socket get 401; the rows say why
    assert.equal((await whoami(d, tokA)).status, 401, "A's HTTP calls get 401");
    assert.equal((await whoami(d, tokA, { "x-vyre-device": B.device })).status, 401, "and forging B's header does not help");
    assert.equal((await call(d, "/v1/devices/revoke", tokA, { deviceId: B.device, idempotencyKey: "rev-b-1" })).status, 401, "A cannot revoke B");
    assert.equal(await live(d, `device=${A.device}`, tokA), 401, "A's live socket gets 401");
    assert.equal(await live(d, `token=${tokA}`), 401, "also with the token in the query");
    const rowOf = (sql: string, ...a: unknown[]) => d.db!.all(sql, ...a)[0] as Record<string, unknown>;
    assert.notEqual(rowOf("SELECT revokedAt FROM devices_device WHERE id = ?", A.device)["revokedAt"], null);
    assert.notEqual(rowOf("SELECT revoked_at FROM devices_session WHERE id = ?", A.session)["revoked_at"], null);

    // B keeps working
    assert.deepEqual(await whoami(d, tokB), { status: 200, device: B.device, person });
    assert.equal(await live(d, `token=${tokB}`), 101, "B's live socket still opens");
    assert.equal(rowOf("SELECT revokedAt FROM devices_device WHERE id = ?", B.device)["revokedAt"], null);

    // sync: devices.revoke called sync.epoch.bump for A with device_revoked; A's replica must purge, B's must not, and A's live connections were told to close
    assert.ok(effectiveEpoch(sync.host.tx, person, A.device) > 0, "A's sync epoch rose, so A purges on next contact");
    assert.equal(effectiveEpoch(sync.host.tx, person, B.device), 0, "B's sync epoch did not move");
    assert.deepEqual(closed, [A.device], "only A's live sync connections were closed");
    const bumps = sync.host.store.read({ type: "sync.epoch_bumped" }).map((e) => payloadOf<Record<string, unknown>>(e));
    assert.equal(bumps.length, 1);
    assert.deepEqual({ personId: bumps[0]!["personId"], reason: bumps[0]!["reason"], deviceId: bumps[0]!["deviceId"] }, { personId: person, reason: "device_revoked", deviceId: A.device });
  } finally { await d.stop(); }
});
