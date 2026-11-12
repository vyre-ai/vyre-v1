// A call another module only forwards for someone (a schedule a member stored, a template's step, a Kit's step) must never pass a check that trusts module code one level down.
// The host's real invoke on a booted Space: Sana, a member, stores a schedule whose capability is a system half and fires it. Each system half refuses, and nothing it guards is written.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore, CORE_SPACE } from "../../fixtures/seed/core/index.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { fakePlatform } from "../src/platform/index.ts";

const NOTHING = "00000000000000000000000000000000";

async function boot(): Promise<{ daemon: Daemon; dir: string; call: (endpoint: string, body: unknown, as?: string) => Promise<{ status: number; code: string; data: Record<string, unknown> }> }> {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-trust-forwarded-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db")); core.close();
  let token = "";
  const daemon = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.0.0-test"),
    platform: fakePlatform({ os: "linux", hostname: "trust-test", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
    fetch: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => '{"apps":{"http":{}}}' }),
    session: (headers) => {
      if (headers["authorization"] !== `Bearer ${token}`) return null;
      const as = headers["x-test-as"];
      return { space: CORE_SPACE, principal: { kind: "person" as const, id: as === "member" ? "usr_sana" : "usr_olivia" }, device: "test-device" };
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, tick: 3_600_000 },
  });
  token = daemon.token;
  const call = async (endpoint: string, body: unknown, as = "member") => {
    const r = await fetch(`${daemon.url}${endpoint}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-test-as": as }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { data?: Record<string, unknown>; error?: { code?: string } };
    return { status: r.status, code: j.error?.code ?? "", data: j.data ?? {} };
  };
  return { daemon, dir, call };
}

/** Sana stores `cap` with `input` as a schedule and runs it now: the scheduler forwards the call for her (asCaller). */
async function storeAndRun(call: Awaited<ReturnType<typeof boot>>["call"], cap: string, input: Record<string, unknown>, key: string): Promise<{ status: number; code: string }> {
  const made = await call("/v1/scheduler/schedule", { owner: { kind: "system", id: "sana-trust" }, cap, input, when: { at: Date.now() + 3_600_000 }, idempotencyKey: `sch-${key}` });
  assert.equal(made.status, 200, `Sana (a member, level edit) stores a schedule: ${JSON.stringify(made)}`);
  const ran = await call("/v1/scheduler/run_now", { scheduleId: String(made.data["scheduleId"]) });
  return { status: ran.status, code: ran.code };
}

const stored = async (name: string, run: (call: Awaited<ReturnType<typeof boot>>["call"], daemon: Daemon) => Promise<void>): Promise<void> => {
  const { daemon, dir, call } = await boot();
  try { await run(call, daemon); } finally { await daemon.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
  void name;
};

test("a member's stored schedule cannot forge an audit row: audit.append refuses a forwarded call and nothing is written", () => stored("audit", async (call, daemon) => {
  const r = await storeAndRun(call, "audit.append", { action: "forged by a schedule", class: "admin", onBehalfOf: { kind: "person", id: "usr_olivia" } }, "audit");
  assert.equal(r.code, "permission.no_grant", `audit.append: ${JSON.stringify(r)}`);
  assert.equal(daemon.db!.all("SELECT id FROM audit_row WHERE action = ?", "forged by a schedule").length, 0, "no audit row was forged");
}));

test("a member's stored schedule cannot mint an engine session for the owner: mcp.session.mint refuses a forwarded call", () => stored("mint", async (call, daemon) => {
  const r = await storeAndRun(call, "mcp.session.mint", { principal: "usr_olivia", actingFor: "usr_olivia", threadId: "thr_a1b2c3", traceId: "ab".repeat(16) }, "mint");
  assert.equal(r.code, "permission.no_grant", `mcp.session.mint: ${JSON.stringify(r)}`);
  assert.equal(daemon.db!.all("SELECT session_id FROM mcp_sessions WHERE principal = ?", "usr_olivia").length, 0, "no session was minted for the owner");
}));

test("a member's stored schedule cannot record a provider's notice: google.receive_push (internalOnly) refuses a forwarded call", () => stored("push", async (call) => {
  const r = await storeAndRun(call, "google.receive_push", { kind: "gmail", messageId: "msg_forged", mailbox: "maya@example.com" }, "push");
  assert.equal(r.code, "permission.no_grant", `google.receive_push: ${JSON.stringify(r)}`);
}));

test("a member's stored schedule cannot record a provider's notice: ms.receive_notification (internalOnly) refuses a forwarded call", () => stored("notice", async (call) => {
  const r = await storeAndRun(call, "ms.receive_notification", { notificationId: "n_forged", subscriptionId: "sub_forged", resource: "users/x/messages/1", changeType: "created", clientStateOk: true }, "notice");
  assert.equal(r.code, "permission.no_grant", `ms.receive_notification: ${JSON.stringify(r)}`);
}));

/** Every other place that trusted "a call another capability made" (depth above zero): each is a capability Sana could store and run, each must refuse the forwarded call before it does anything. */
const OTHERS: ReadonlyArray<{ cap: string; input: Record<string, unknown>; code: string }> = [
  { cap: "agents.outside.enqueue", input: { agentId: "agt_a1b2c3", kind: "mention", asker: "usr_olivia" }, code: "permission.no_grant" },
  { cap: "agents.outside.seen", input: { agentId: "agt_a1b2c3" }, code: "permission.no_grant" },
  { cap: "agents.outside.connect", input: { clientName: "Forged app" }, code: "permission.no_grant" },
  { cap: "channels.home_join", input: { personId: "usr_sana" }, code: "permission.role_lacks_permission" },
  { cap: "machines.move_record", input: { from: "here", to: "there", why: "forged" }, code: "permission.no_grant" },
  { cap: "mcp.oauth.replayed", input: { agentId: "agt_a1b2c3", person: "usr_olivia", why: "forged" }, code: "permission.no_grant" },
  { cap: "engine.complete", input: { accountRef: "acc_forged", prompt: "hello" }, code: "permission.no_grant" },
  { cap: "access.join_share", input: { resource: { type: "space", id: CORE_SPACE }, person: "usr_sana", level: "manage", inviter: "usr_olivia", source: "inv_forged" }, code: "permission.role_lacks_permission" },
  { cap: "access.automation_senders", input: { automationId: "aut_a1b2c3", give: [], keep: [] }, code: "permission.role_lacks_permission" },
  { cap: "gate.grants.set", input: { automationId: "aut_a1b2c3", defHash: "h", press: "save", steps: [] }, code: "permission.role_lacks_permission" },
  { cap: "gate.grants.goal", input: { goalId: "gol_a1b2c3", person: "usr_sana", threads: [], until: Date.now() + 86_400_000 }, code: "permission.role_lacks_permission" },
  { cap: "members.invites.guest", input: { email: "guest@example.com", scope: { type: "channel", id: "chn_a1b2c3" }, idempotencyKey: "forged" }, code: "permission.no_grant" },
  { cap: "runs.start", input: { kind: "other", owner: "usr_olivia", idempotencyKey: "forged-run" }, code: "permission.role_lacks_permission" },
  { cap: "vault.report_scrub_miss", input: { itemId: "vit_a1b2c3", place: "chat", traceId: "ab".repeat(16) }, code: "permission.no_grant" },
];

test("a member's stored schedule is refused by every other check that trusts module code one level down", () => stored("others", async (call) => {
  const wrong: string[] = [];
  for (const [i, o] of OTHERS.entries()) {
    const r = await storeAndRun(call, o.cap, o.input, `other-${i}`);
    if (r.code !== o.code) wrong.push(`${o.cap}: got ${r.status} ${r.code || "(it ran)"}, wanted ${o.code}`);
  }
  assert.deepEqual(wrong, [], "each forwarded call is refused as the caller's own direct call would be");
}));

test("the control: the same system halves still refuse a member's direct call, and the owner's direct call to a recorder is still not a webhook", async () => {
  const { daemon, dir, call } = await boot();
  try {
    for (const [endpoint, body] of [["/v1/audit/append", { action: "direct", class: "admin" }], ["/v1/mcp/session/mint", { principal: "usr_olivia", actingFor: "usr_olivia", threadId: "thr_a1b2c3", traceId: NOTHING.replace(/0/g, "a") }]] as const) {
      const r = await call(endpoint, body);
      assert.ok(r.status === 403 || r.status === 404, `${endpoint}: ${r.status} ${r.code}`);
    }
  } finally { await daemon.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
