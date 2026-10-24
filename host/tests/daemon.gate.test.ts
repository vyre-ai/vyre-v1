// P-H_04: the Gate on a booted daemon. vyred boots the seeded core Space with the Gate module live; the invoke pipeline asks the Gate hook (host/src/daemon/gate-hook.ts, wrapped in
// withGateNesting) about every gated act.
//   - an agent's mail.send is held once: the call answers 202 with the hold's task, the provider is not reached, one hold row exists
//   - a person approves with the sealed token; gate.release re-invokes the send as the agent with that token; the send runs once and its provider call (resend.send_email, also a `send`
//     act, over the real Resend module and a recorded fake network) is not held again
//   - a person's own send is not held at all
//   - a token minted for another payload does not release anything
// mail.send's body is a test handler (the mail module is not live here); everything else is the real pipeline, registry, Gate module, kernel authorize and Resend module.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore, CORE_SPACE } from "../../fixtures/seed/core/index.ts";
import { createCtxSeal } from "../src/ctx/seal.ts";
import type { FetchLike } from "../src/ctx/http.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import { registry } from "../../generated/registry.ts";
import { resolveResource } from "../src/routes/resource.ts";
import { createGateHook, whenHolds } from "../src/daemon/gate-hook.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";

const KEY = { key: "gate-test-seal-key-0123456789abcdef", keyId: "k1" };
const MAILBOX = "mbx_hello";
const TASK = "tsk_a1b2c3";   // the id the (stub) tasks module answers with
const AGENT = "agt_scout";
const OLIVIA = "usr_olivia";
const SANA = "usr_sana";   // a member

const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));
let n = 0;
const ev = (type: string, entity: string, id: string, payload: unknown) => ({
  id: `evt_gatetest_${String(++n).padStart(4, "0")}`, type, sv: 1, trace_id: "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0", actor: "svc_seed", vis: "space" as const, entity, entity_id: id, payload,
});

/** The seeded core Space plus what a send needs: a mailbox, the task the stub tasks module names, and grants that let the agent use the mailbox and the Space (its provider call). */
function seededDir(): string {
  const core = bootCore();
  const res = (id: string, type: string) => ev("resource.created", "resource", id, { id, type, parent_id: CORE_SPACE, label: 0, owner_id: OLIVIA, holds: 0 });
  const grant = (id: string, type: string, rid: string, who = AGENT, level = "use") => ev("grant.created", "grant", id, { id, subject_kind: "actor", subject_id: who, resource_type: type, resource_id: rid, level, by: OLIVIA });
  for (const r of core.store.appendBatch([res(MAILBOX, "mailbox"), res(TASK, "task"), grant("gr_scout_mbx", "mailbox", MAILBOX), grant("gr_scout_spc", "space", CORE_SPACE), grant("gr_sana_mbx", "mailbox", MAILBOX, SANA), grant("gr_sana_spc", "space", CORE_SPACE, SANA), grant("gr_olivia_spc", "space", CORE_SPACE, OLIVIA, "manage")])   // the seed has no role-expanded grants: the Space itself (the Gate) creates the Approve task as its owner) {
    assert.ok(r.ok, "seed event accepted");
  }
  const dir = tmp("vyre-daemon-gate-");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}
function machine(dir: string) {
  return fakePlatform({
    os: "linux", hostname: "gate-test", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  });
}
const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

/** Resend as recorded: one accepted email per POST /emails. */
function resend() {
  const emails: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    const ok = (body: unknown) => ({ status: 200, headers: { get: () => null }, text: () => Promise.resolve(JSON.stringify(body)) });
    if ((init?.method ?? "GET") === "POST" && url === "https://api.resend.com/emails") { emails.push(init?.body ?? ""); return ok({ id: `re_${emails.length}` }); }
    return { status: 404, headers: { get: () => null }, text: () => Promise.resolve("{}") };
  };
  return { emails, fetch };
}

const SEND = (key: string) => ({ mailboxId: MAILBOX, to: [{ address: "pat@acme.test" }], subject: "Hello", text: "Hi Pat", idempotencyKey: key });
/** who the send body ran as, per call */
const ranAs: { cap: string; principal: string; actingFor: string | undefined; run: string | undefined }[] = [];
const sendHandler = (async (ctx: { principal: { id: string }; actingFor?: string; run?: string; call(cap: string, input: unknown): Promise<unknown> }, input: { subject: string; text: string; idempotencyKey: string }) => {
  ranAs.push({ cap: "mail.send", principal: ctx.principal.id, actingFor: ctx.actingFor, run: ctx.run });
  const out = (await ctx.call("resend.send_email", { from: "maya@vyre.test", to: ["pat@acme.test"], subject: input.subject, text: input.text, idempotencyKey: `${input.idempotencyKey}:out` })) as { providerId: string };
  return { status: "sent", messageId: "eml_a1b2c3", providerId: out.providerId };
}) as never;

async function boot(dir: string, net: ReturnType<typeof resend>): Promise<Daemon> {
  let token = "";
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: machine(dir), fetch: caddyFetch, http: net.fetch, sealKey: KEY,
    vault: { secret: async (h) => { if (h === "#Resend_Key") return "re_live_key"; throw new Error("no such item"); }, signRs256: async () => "" },
    seams: { files: { read: () => Promise.reject(new Error("no files")) }, blobs: { put: () => Promise.reject(new Error("no blobs")) }, members: { emails: () => Promise.resolve([]) } },
    // who calls: the owner by default; the agent (acting for the owner) when the request says so
    session: (h) => {
      if (h["authorization"] !== `Bearer ${token}`) return null;
      const asAgent = h["x-test-as"] === "agent";
      return asAgent
        ? { space: CORE_SPACE, principal: { kind: "agent", id: AGENT }, actingFor: h["x-test-for"] ?? OLIVIA, device: "test-device" }
        : { space: CORE_SPACE, principal: { kind: "person", id: OLIVIA }, device: "test-device" };
    },
    extra: { handlers: { "mail.send": sendHandler } },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, tick: 3_600_000 },
  });
  token = d.token;
  return d;
}
const call = (d: Daemon, p: string, body: unknown, as: "agent" | "person" = "person", forPerson?: string) => fetch(`${d.url}${p}`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}`, ...(as === "agent" ? { "x-test-as": "agent", ...(forPerson ? { "x-test-for": forPerson } : {}) } : {}) }, body: JSON.stringify(body),
});
const holds = (d: Daemon): { id: string; state: string; decision_id: string; payload_hash: string; cap_name: string; principal_id: string }[] =>
  d.db!.all("SELECT id, state, decision_id, payload_hash, cap_name, principal_id FROM gate_holds ORDER BY created_at") as never;

/** The token tasks.act mints when a person approves: sealed claims bound to the task, the hold, the decision and the payload hash. */
function approvalFor(h: { id: string; decision_id: string; payload_hash: string }, by = OLIVIA): string {
  const sealed = createCtxSeal(KEY).seal(
    new TextEncoder().encode(JSON.stringify({ v: 1, task: TASK, hold: h.id, decision: h.decision_id, hash: h.payload_hash, by, forPerson: null, device: null, exp: Date.now() + 600_000 })), "tasks.approval");
  return `apv_${Buffer.from(JSON.stringify(sealed)).toString("base64url")}`;
}

test("daemon.gate: an agent's send is held once, and the provider is not reached", async () => {
  const net = resend();
  const d = await boot(seededDir(), net);
  try {
    const r = await call(d, "/v1/mail/send", SEND("idem-agent-1"), "agent");
    assert.equal(r.status, 202, JSON.stringify(await r.clone().json()));
    const body = (await r.json()) as { data: { status: string; taskId: string } };
    assert.deepEqual([body.data.status, body.data.taskId], ["held", TASK]);
    const h = holds(d);
    assert.equal(h.length, 1, "exactly one hold");
    assert.deepEqual([h[0]!.state, h[0]!.cap_name, h[0]!.principal_id], ["held", "mail.send", AGENT]);
    assert.equal(net.emails.length, 0, "nothing was sent");
  } finally { await d.stop(); }
});

test("daemon.gate: once a person approves, the send goes out once and its provider call is not held again", async () => {
  const net = resend();
  const d = await boot(seededDir(), net);
  try {
    const first = await call(d, "/v1/mail/send", SEND("idem-agent-2"), "agent");
    assert.equal(first.status, 202);
    const [hold] = holds(d);
    const released = await call(d, "/v1/gate/release", { holdId: hold!.id, taskId: TASK, approvalToken: approvalFor(hold!) });
    assert.equal(released.status, 200, JSON.stringify(await released.clone().json()));
    const { data } = (await released.json()) as { data: { result: { status: string; providerId: string } } };
    assert.deepEqual([data.result.status, data.result.providerId], ["sent", "re_1"]);
    assert.equal(net.emails.length, 1, "the provider got the email once");
    const after = holds(d);
    assert.equal(after.length, 1, "no second hold for the provider call");
    assert.equal(after[0]!.state, "approved");
  } finally { await d.stop(); }
});

test("daemon.gate: a person's own send is not held", async () => {
  const net = resend();
  const d = await boot(seededDir(), net);
  try {
    const r = await call(d, "/v1/mail/send", SEND("idem-person-1"));
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
    assert.equal(((await r.json()) as { data: { status: string } }).data.status, "sent");
    assert.equal(net.emails.length, 1);
    assert.equal(holds(d).length, 0, "no hold, not even for the provider call");
  } finally { await d.stop(); }
});

test("daemon.gate: an approval minted for another payload releases nothing", async () => {
  const net = resend();
  const d = await boot(seededDir(), net);
  try {
    await call(d, "/v1/mail/send", SEND("idem-agent-3"), "agent");
    const [hold] = holds(d);
    const wrong = approvalFor({ id: hold!.id, decision_id: hold!.decision_id, payload_hash: "0".repeat(64) });
    const r = await call(d, "/v1/gate/release", { holdId: hold!.id, taskId: TASK, approvalToken: wrong });
    assert.notEqual(r.status, 200);
    assert.equal(net.emails.length, 0, "nothing was sent");
    assert.equal(holds(d)[0]!.state, "held");
  } finally { await d.stop(); }
});

test("daemon.gate: an agent acting for a member, approved by the owner, resumes as that agent for that member and never with the owner's rights", async () => {
  const net = resend();
  const d = await boot(seededDir(), net);
  try {
    ranAs.length = 0;
    const first = await call(d, "/v1/mail/send", SEND("idem-agent-5"), "agent", SANA);
    assert.equal(first.status, 202, JSON.stringify(await first.clone().json()));
    const [hold] = holds(d);
    assert.equal((d.db!.all("SELECT acting_for FROM gate_holds WHERE id = ?", hold!.id)[0] as { acting_for: string }).acting_for, SANA, "the row keeps whom the agent acted for");
    const released = await call(d, "/v1/gate/release", { holdId: hold!.id, taskId: TASK, approvalToken: approvalFor(hold!) });   // Olivia, the owner, approves
    assert.equal(released.status, 200, JSON.stringify(await released.clone().json()));
    assert.deepEqual(ranAs, [{ cap: "mail.send", principal: AGENT, actingFor: SANA, run: undefined }], "the resumed send ran as the asker, not as the approver");
    assert.equal(net.emails.length, 1);
  } finally { await d.stop(); }
});

test("daemon.gate: a hold whose stored caller was changed after it was parked does not resume", async () => {
  const net = resend();
  const d = await boot(seededDir(), net);
  try {
    await call(d, "/v1/mail/send", SEND("idem-agent-6"), "agent", SANA);
    const [hold] = holds(d);
    d.db!.run("UPDATE gate_holds SET acting_for = ? WHERE id = ?", OLIVIA, hold!.id);   // an attempt to make the agent act for the owner
    const r = await call(d, "/v1/gate/release", { holdId: hold!.id, taskId: TASK, approvalToken: approvalFor(hold!) });
    assert.notEqual(r.status, 200);
    assert.equal(net.emails.length, 0);
  } finally { await d.stop(); }
});

test("daemon.gate: a task made with no record (the Approve task the Gate opens) is created in the Space", () => {
  const tasksCreate = (registry.capabilities as unknown as CapabilityDef[]).find((c) => c.name === "tasks.create")!;
  assert.deepEqual(resolveResource(tasksCreate, { kind: "approve" }, CORE_SPACE), { type: "task", id: null, parent: CORE_SPACE });
  assert.deepEqual(resolveResource(tasksCreate, { recordId: "rec_a1b2c3" }, CORE_SPACE), { type: "task", id: null, parent: "rec_a1b2c3" });
});

// ---- the capability's `when`

const AGT = { principal: { kind: "agent" as const, id: AGENT } };
const PER = { principal: { kind: "person" as const, id: OLIVIA } };

test("daemon.gate when: the expression is read over the caller and the input, and an unreadable one counts as holding", () => {
  assert.equal(whenHolds(undefined, {}, AGT), true, "no when: always");
  assert.equal(whenHolds("actor.kind != 'person'", {}, AGT), true);
  assert.equal(whenHolds("actor.kind != 'person'", {}, PER), false);
  assert.equal(whenHolds("input.method != 'GET'", { method: "GET" }, AGT), false);
  assert.equal(whenHolds("input.method != 'GET'", { method: "POST" }, AGT), true);
  assert.equal(whenHolds("input.push == true", { push: false }, AGT), false);
  assert.equal(whenHolds("true", {}, PER), true);
  assert.equal(whenHolds("git.is_protected(input.branch)", { branch: "main" }, AGT), true, "an expression the evaluator cannot run asks");
  assert.equal(whenHolds("((", {}, AGT), true, "a broken expression asks");
});

test("daemon.gate when: the Gate is asked only when the capability's when holds for this call", async () => {
  const asked: unknown[] = [];
  const hook = createGateHook({ call: async (cap, input) => { asked.push([cap, input]); return { hold: true }; }, unseal: () => new Uint8Array(), now: () => 0, hold: () => null });
  const cap = (gate: CapabilityDef["gate"]) => ({ name: "example.act", v: 1, gate }) as unknown as CapabilityDef;
  const seed = (p: typeof AGT | typeof PER) => ({ space: CORE_SPACE, ...p });
  assert.equal(await hook.applies(cap({ act: "delete", when: "input.method != 'GET'" }), { method: "GET" }, seed(AGT)), null, "when is false: not asked, not held");
  assert.deepEqual(asked, []);
  assert.deepEqual(await hook.applies(cap({ act: "delete", when: "input.method != 'GET'" }), { method: "POST" }, seed(AGT)), { act: "delete" });
  assert.equal(asked.length, 1);
  assert.deepEqual(await hook.applies(cap({ act: "send" }), {}, seed(AGT)), { act: "send" }, "no when: the rule decides");
  assert.equal(await hook.applies(cap({ act: "none" }), {}, seed(AGT)), null, "act none never asks");
  assert.equal(await hook.applies(cap(undefined), {}, seed(AGT)), null);
  const calm = createGateHook({ call: async () => ({ hold: false }), unseal: () => new Uint8Array(), now: () => 0, hold: () => null });
  assert.equal(await calm.applies(cap({ act: "send" }), {}, seed(PER)), null, "the rule says no: not held");
});

// P-H_04 final run: each named test above shows its own ok line in the run on the last commit.
