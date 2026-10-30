// Definitions (spec 2.12, 3.7): graph validation against the step and trigger catalogue, version pinning, and Promote with its access diff.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, bob, create, goodDefinition, node } from "../fixtures/seed.ts";
import { loadRunPlan } from "../impl.ts";
import { findRunLink } from "../projections.ts";

const validate = async (h: Harness, definition: unknown): Promise<{ ok: boolean; issues: { nodeId?: string; severity: string; message: string }[] }> =>
  h.call("automations.validate", { definition }, alice);
const trig = [{ key: "manual" }];
async function refused(p: Promise<unknown>, code: string, reason?: string): Promise<void> {
  await assert.rejects(p, (e) => { assert.equal(codeOf(e), code); if (reason) assert.equal(reasonOf(e), reason); return true; });
}
const makeLive = async (h: Harness, over: Record<string, unknown> = {}): Promise<string> => {
  const id = (await h.call("automations.create", create(over), alice)).automation.id as string;
  await h.call("automations.set_enabled", { automationId: id, enabled: true }, alice);
  return id;
};

// ---- graph validation ----

test("a complete definition passes with nothing to say", async () => {
  const h = harness();
  const r = await validate(h, goodDefinition());
  assert.deepEqual(r, { ok: true, issues: [] });
});

test("missing inputs are named per step", async () => {
  const h = harness();
  const r = await validate(h, { triggers: trig, nodes: [node("a", "records.update", { type: "contact" }), node("b", "send_email", { to: "x@example.com", subject: "Hi", body: "Hello" })] });
  assert.equal(r.ok, false);
  const msgs = r.issues.filter((i) => i.severity === "error").map((i) => `${i.nodeId}: ${i.message}`);
  assert.deepEqual(msgs.sort(), ["a: Update a record needs patch.", "a: Update a record needs recordId.", "b: Send an email needs a mailbox."]);
  assert.ok(r.issues.some((i) => i.nodeId === "b" && i.severity === "warning"), "b is not reached from a");
});

test("an authenticated request needs a connection and cannot store a secret", async () => {
  const h = harness();
  const secret = await validate(h, { triggers: trig, nodes: [node("r", "connector_request", { connector: "acme", action: "ping", connectionId: "con_1", input: { apiKey: "sk-live" } })] });
  assert.ok(secret.issues.some((i) => /cannot hold a secret/.test(i.message)));
  const missing = await validate(h, { triggers: trig, nodes: [node("r", "connector_request", { connector: "acme", action: "ping" })] });
  assert.ok(missing.issues.some((i) => /needs a connection/.test(i.message)));
});

test("create and update refuse a pasted secret anywhere, including a draft, and keep a page token", async () => {
  const h = harness();
  const withPatch = (patch: Record<string, unknown>) => ({ triggers: trig, nodes: [node("a", "records.update", { type: "contact", recordId: "rec_abc", patch })] });
  await refused(h.call("automations.create", create({ definition: withPatch({ note: "sk-live-pasted" }) }), alice), "validation.bad_input", "secret");
  await refused(h.call("automations.create", create({ definition: withPatch({ note: "Bearer pasted-token" }) }), alice), "validation.bad_input", "secret");
  await refused(h.call("automations.create", create({ definition: withPatch({ apiKey: "not-a-token" }) }), alice), "validation.bad_input", "secret");
  await refused(h.call("automations.create", create({ definition: { triggers: [{ key: "manual", filter: { token: "x" } }], nodes: [] } }), alice), "validation.bad_input", "secret");
  assert.equal((await h.call("automations.list", {}, alice)).automations.length, 0);
  const page = withPatch({ pageToken: "next", status: "active" });
  const made = await h.call("automations.create", create({ definition: page }), alice);
  const id = made.automation.id as string;
  assert.equal(made.automation.status, "draft");
  assert.equal(made.automation.definition.nodes[0].input.patch.pageToken, "next");
  await refused(h.call("automations.update", { automationId: id, definition: withPatch({ note: "key_live_pasted" }) }, alice), "validation.bad_input", "secret");
  const still = await h.call("automations.get", { automationId: id }, alice);
  assert.equal(still.automation.version, 1);
  assert.equal(still.automation.definition.nodes[0].input.patch.pageToken, "next");
  const reported = await validate(h, withPatch({ authorization: "x" }));
  assert.equal(reported.ok, false);
  assert.ok(reported.issues.some((i) => /cannot hold a secret/.test(i.message)));
});

test("steps and triggers that are not in the catalogue are errors", async () => {
  const h = harness();
  const r = await validate(h, { triggers: [{ key: "teleport" }], nodes: [node("a", "do_magic", {})] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.issues.filter((i) => i.severity === "error").map((i) => i.message).sort(), ["There is no step called do_magic.", "There is no trigger called teleport."]);
});

test("references to steps that do not exist, and two steps with one id, are errors", async () => {
  const h = harness();
  const ok = { type: "contact", recordId: "rec_a", patch: {} };
  const r = await validate(h, {
    triggers: trig, start: ["zzz"],
    nodes: [node("a", "records.update", ok, { next: ["gone"] }), node("a", "records.update", ok), node("c", "records.update", ok, { branches: [{ label: "x", to: "nope" }], onError: { mode: "route", route: "nowhere" } })],
  });
  const msgs = r.issues.filter((i) => i.severity === "error").map((i) => i.message);
  assert.ok(msgs.includes("Two steps share the id a."));
  assert.ok(msgs.includes("This step points at gone, which does not exist."));
  assert.ok(msgs.includes("This step points at nope, which does not exist."));
  assert.ok(msgs.includes("This step points at nowhere, which does not exist."));
  assert.ok(msgs.includes("The start step zzz does not exist."));
});

test("a step nothing reaches is a warning; the Automation is still valid", async () => {
  const h = harness();
  const ok = { type: "contact", recordId: "rec_a", patch: {} };
  const r = await validate(h, { triggers: trig, nodes: [node("a", "records.update", ok), node("island", "records.update", ok)] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.issues, [{ nodeId: "island", severity: "warning", message: "No path reaches this step." }]);
  const start = await validate(h, { triggers: trig, start: ["island"], nodes: [node("a", "records.update", ok), node("island", "records.update", ok)] });
  assert.deepEqual(start.issues.map((i) => i.nodeId), ["a"], "the start list decides what is reached");
});

test("a loop above 1000 iterations is an error, and so is a loop inside a loop", async () => {
  const h = harness();
  const make = node("make", "records.create", { type: "note", fields: { title: "Item" } });
  const after = node("after", "stop", {});
  const over = await validate(h, {
    triggers: trig,
    nodes: [node("each", "loop", { items: "trigger.items", maxIterations: 1001 }, { branches: [{ label: "body", to: "make" }], next: ["after"] }), make, after],
  });
  assert.equal(over.ok, false);
  assert.ok(over.issues.some((i) => i.nodeId === "each" && i.severity === "error" && i.message === "A loop allows at most 1000 iterations."));
  const atCap = await validate(h, {
    triggers: trig,
    nodes: [node("each", "loop", { items: "trigger.items", maxIterations: 1000 }, { branches: [{ label: "body", to: "make" }], next: ["after"] }), make, after],
  });
  assert.equal(atCap.ok, true, JSON.stringify(atCap.issues));
  const nested = await validate(h, {
    triggers: trig,
    nodes: [
      node("outer", "loop", { items: "trigger.items" }, { branches: [{ label: "body", to: "prep" }], next: ["after"] }),
      node("prep", "records.create", { type: "note", fields: { title: "Prep" } }, { next: ["inner"] }),
      node("inner", "loop", { items: "item.rows" }, { branches: [{ label: "body", to: "make" }], next: ["after"] }),
      make,
      after,
    ],
  });
  assert.equal(nested.ok, false);
  assert.ok(nested.issues.some((i) => i.nodeId === "inner" && i.severity === "error" && i.message === "A loop cannot contain another loop."));
  const sequence = await validate(h, {
    triggers: trig,
    nodes: [
      node("first", "loop", { items: "trigger.items", maxIterations: 1000 }, { branches: [{ label: "body", to: "make" }], next: ["second"] }),
      make,
      node("second", "loop", { items: "trigger.more", maxIterations: 1000 }, { branches: [{ label: "body", to: "make2" }] }),
      node("make2", "records.create", { type: "note", fields: { title: "More" } }),
    ],
  });
  assert.equal(sequence.ok, true, JSON.stringify(sequence.issues));
});

test("a path that loops back is an error unless it goes through a Loop step", async () => {
  const h = harness();
  const find = { type: "contact" };
  const bad = await validate(h, { triggers: trig, nodes: [node("a", "records.find", find, { next: ["b"] }), node("b", "records.find", find, { next: ["a"] })] });
  assert.equal(bad.ok, false);
  assert.match(bad.issues.find((i) => i.severity === "error")!.message, /loops back to a without a Loop step/);
  const good = await validate(h, { triggers: trig, nodes: [node("a", "records.find", find, { next: ["b"] }), node("b", "loop", { items: "{{ steps.a.out.records }}" }, { next: ["a"] })] });
  assert.equal(good.ok, true);
});

// ---- live steps: Run code and the AI step ----

type Prov = { id: string; handle?: string; itemId: string; name: string; connection: string; scope: string; spaceMayUse: boolean; state: string };
const prov = (over: Partial<Prov> = {}): Prov => ({ id: "prv_1", handle: "#Mine_Anthropic", itemId: "vit_1", name: "Mine Anthropic", connection: "api_key", scope: "mine", spaceMayUse: false, state: "ok", ...over });
const shared = (over: Partial<Prov> = {}): Prov => prov({ id: "prv_s", handle: "#Team_Key", itemId: "vit_s", name: "Team key", scope: "shared", ...over });
function liveHarness(opts: { code?: boolean | string; providers?: Prov[] } = {}) {
  const h = harness({ authorize: () => false });
  const code = opts.code ?? true;
  h.callee("steps.support", () => ({ code: code === true ? { available: true } : { available: false, reason: code === false ? "No sandbox." : code }, ai: { available: true } }));
  h.callee("providers.list", () => ({ providers: opts.providers ?? [] }));
  return h;
}
const aiNode = (over: Record<string, unknown> = {}, ai?: Record<string, unknown>) => node("a", "ai", { prompt: "Summarise", ...over }, ai ? { ai } : {});
const draftWith = async (h: Harness, n: ReturnType<typeof node>): Promise<string> => (await h.call("automations.create", create({ definition: { triggers: trig, nodes: [n] } }), alice)).automation.id as string;
const turnOn = (h: Harness, id: string) => h.call("automations.set_enabled", { automationId: id, enabled: true }, alice);
const messageOf = (e: unknown): string => (e as { error?: { message?: string } }).error?.message ?? String(e);

test("a code step can be saved anywhere, and turned on only where this server can sandbox it", async () => {
  const off = liveHarness({ code: "Run code needs a Linux server with bubblewrap." });
  const id = await draftWith(off, node("a", "code", { source: "return 1" }));
  assert.equal((await off.call("automations.get", { automationId: id }, alice)).automation.definition.nodes[0].key, "code");
  await assert.rejects(turnOn(off, id), (e) => { assert.equal(codeOf(e), "validation.precondition_failed"); assert.equal(reasonOf(e), "live_step"); assert.match(messageOf(e), /Run code cannot be turned on here\. Run code needs a Linux server with bubblewrap\./); return true; });
  const on = liveHarness();
  const id2 = await draftWith(on, node("a", "code", { source: "return 1" }));
  assert.equal((await turnOn(on, id2)).automation.status, "on");
});

test("the step catalogue hides Run code where the server cannot sandbox it, and shows it where it can", async () => {
  const keys = async (h: Harness): Promise<string[]> => ((await h.call("automations.steps.list", {}, alice)).steps as { key: string }[]).map((s) => s.key);
  assert.equal((await keys(liveHarness({ code: false }))).includes("code"), false);
  assert.equal((await keys(liveHarness({ code: false }))).includes("ai"), true);
  const both = await keys(liveHarness());
  assert.equal(both.includes("code") && both.includes("ai"), true);
  assert.equal((await keys(harness())).some((k) => k === "code" || k === "ai"), false, "a server that has not said it can run them hides them");
});

test("a Personal AI step needs no key: it turns on when the owner has an account that works on the server", async () => {
  const h = liveHarness({ providers: [prov()] });
  const id = await draftWith(h, aiNode());
  assert.equal((await turnOn(h, id)).automation.status, "on");
});

test("a Personal AI step with no working account is refused, and the message says what to add", async () => {
  const none = liveHarness({ providers: [] });
  await assert.rejects(turnOn(none, await draftWith(none, aiNode())), (e) => { assert.equal(reasonOf(e), "live_step"); assert.match(messageOf(e), /your own AI account/); assert.match(messageOf(e), /AI settings/); return true; });
  const sub = liveHarness({ providers: [prov({ connection: "subscription", spaceMayUse: false })] });
  await assert.rejects(turnOn(sub, await draftWith(sub, aiNode())), (e) => { assert.match(messageOf(e), /Let the Space run work on my subscription/); return true; });
  const subOk = liveHarness({ providers: [prov({ connection: "subscription", spaceMayUse: true })] });
  assert.equal((await turnOn(subOk, await draftWith(subOk, aiNode()))).automation.status, "on");
  const broken = liveHarness({ providers: [prov({ state: "needs_sign_in" })] });
  await assert.rejects(turnOn(broken, await draftWith(broken, aiNode())), (e) => { assert.match(messageOf(e), /your own AI account/); return true; });
});

test("a Personal AI step may name one of its owner's accounts, and an unknown one is refused", async () => {
  const h = liveHarness({ providers: [prov()] });
  assert.equal((await turnOn(h, await draftWith(h, aiNode({}, { keyId: "#Mine_Anthropic" })))).automation.status, "on");
  await assert.rejects(turnOn(h, await draftWith(h, aiNode({}, { keyId: "#Nope" }))), (e) => { assert.match(messageOf(e), /#Nope is not in the Vault/); return true; });
});

test("a Space AI step needs a Space-shared key in the step", async () => {
  const h = liveHarness({ providers: [prov(), shared()] });
  const mk = async (ai?: Record<string, unknown>): Promise<string> => {
    const id = await draftWith(h, aiNode({}, ai));
    await h.call("automations.promote", { automationId: id, confirm: true, replaceKeys: [{ stepId: "a", keyId: "#Team_Key" }].filter(() => false) }, alice).catch(() => undefined);
    return id;
  };
  // promote an AI step that already names a shared key, then check the other cases on the Space copy
  const okId = await mk({ keyId: "#Team_Key" });
  assert.equal((await h.call("automations.get", { automationId: okId }, alice)).automation.kind, "space");
  assert.equal((await turnOn(h, okId)).automation.status, "on");
  const bareId = await draftWith(h, aiNode());
  await h.call("automations.promote", { automationId: bareId, confirm: true, replaceKeys: [{ stepId: "a", keyId: "#Team_Key" }] }, alice);
  assert.equal((await h.call("automations.get", { automationId: bareId }, alice)).automation.definition.nodes[0].ai.keyId, "#Team_Key", "Promote fills the step with the shared key it was given");
  const mineId = await draftWith(h, aiNode({}, { keyId: "#Mine_Anthropic" }));
  await h.call("automations.promote", { automationId: mineId, confirm: true }, alice);
  await assert.rejects(turnOn(h, mineId), (e) => { assert.match(messageOf(e), /belongs to one person/); assert.match(messageOf(e), /Space-shared AI key/); return true; });
});

test("Promote asks for a shared key for an AI step that had none", async () => {
  const h = liveHarness({ providers: [shared()] });
  h.callee("vault.items.list", () => ({ items: [] }));
  const id = await draftWith(h, aiNode());
  const diff = (await h.call("automations.preview_promote", { automationId: id }, alice));
  assert.equal(diff.ready, false);
  assert.deepEqual(diff.diff.keysToReplace.map((k: { stepId: string; keyId: string }) => [k.stepId, k.keyId]), [["a", ""]]);
  await refused(h.call("automations.promote", { automationId: id, confirm: true }, alice), "validation.precondition_failed", "keys_not_replaced");
});

test("a Space AI step with no key is refused and the message names what to add", async () => {
  const h = liveHarness({ providers: [shared()] });
  h.callee("vault.items.list", () => ({ items: [] }));
  const id = await draftWith(h, aiNode());
  await h.call("automations.promote", { automationId: id, confirm: true, replaceKeys: [{ stepId: "a", keyId: "#Team_Key" }] }, alice);
  // the key is later removed from the Vault
  h.callee("providers.list", () => ({ providers: [] }));
  await assert.rejects(turnOn(h, id), (e) => { assert.match(messageOf(e), /#Team_Key is not in the Vault/); assert.match(messageOf(e), /Space-shared AI key/); return true; });
});

test("a schedule can be turned on", async () => {
  const h = harness();
  const id = (await h.call("automations.create", create({
    definition: goodDefinition({ triggers: [{ key: "schedule", config: { cron: "0 9 * * 1-5", timezone: "UTC", missed: "skip" } }] }),
  }), alice)).automation.id as string;
  const on = await h.call("automations.set_enabled", { automationId: id, enabled: true }, alice);
  assert.equal(on.automation.status, "on");
});

test("an AI step needs a prompt; a Personal Space cannot use a webhook trigger", async () => {
  const h = harness();
  const bare = await validate(h, { triggers: trig, nodes: [node("a", "ai", { prompt: "Summarise" })] });
  assert.equal(bare.ok, true, "a Personal AI step runs on its owner's account and needs neither");
  const noPrompt = await validate(h, { triggers: trig, nodes: [node("a", "ai", {})] });
  assert.equal(noPrompt.issues[0]!.message, "AI step needs prompt.");
  const withAgent = await validate(h, { triggers: trig, nodes: [node("a", "ai", { prompt: "Summarise" }, { ai: { agentId: "agt_helper" } })] });
  assert.equal(withAgent.ok, true);
  const hook = { triggers: [{ key: "webhook" }], nodes: [] };
  assert.equal((await validate(h, hook)).ok, true);
  h.policy("space.personal", true);
  const r = await validate(h, hook);
  assert.equal(r.ok, false);
  assert.equal(r.issues[0]!.message, "A webhook is received needs a Team Space.");
});

// ---- version pinning ----

test("a Run keeps the definition version it started on, even after the Automation changes", async () => {
  const h = harness();
  const id = await makeLive(h);
  const first = await h.call("automations.run", { automationId: id }, alice);
  const v1 = loadRunPlan({ db: h.db }, first.runId)!;
  assert.equal(v1.link.version, 1);

  const next = goodDefinition({ nodes: [node("a", "records.update", { type: "contact", recordId: "rec_abc", patch: { status: "won" } })] });
  const upd = await h.call("automations.update", { automationId: id, definition: next }, alice);
  assert.equal(upd.automation.version, 2);
  const second = await h.call("automations.run", { automationId: id }, alice);
  assert.equal(loadRunPlan({ db: h.db }, second.runId)!.link.version, 2);

  const again = loadRunPlan({ db: h.db }, first.runId)!;
  assert.equal(again.link.version, 1, "the first Run is still on version 1");
  assert.deepEqual(again.definition, goodDefinition(), "and reads the definition it started with");
  assert.deepEqual(loadRunPlan({ db: h.db }, second.runId)!.definition, next);
  assert.equal(h.runs[0]!.definitionVersion, 1);
  assert.equal(h.runs[1]!.definitionVersion, 2);
  assert.equal(findRunLink(h.db, "run_missing"), undefined);
});

test("replay offers the same version or the current one; test can pin any earlier version", async () => {
  const h = harness();
  const id = await makeLive(h);
  const old = await h.call("automations.run", { automationId: id }, alice);
  await h.call("automations.update", { automationId: id, definition: goodDefinition({ nodes: [node("a", "records.update", { type: "contact", recordId: "rec_zzz", patch: {} })] }) }, alice);
  const same = await h.call("automations.replay", { automationId: id, runId: old.runId, version: "same", confirm: true }, alice);
  const cur = await h.call("automations.replay", { automationId: id, runId: old.runId, version: "current", confirm: true }, alice);
  assert.equal(findRunLink(h.db, same.runId)!.version, 1);
  assert.equal(findRunLink(h.db, cur.runId)!.version, 2);
  assert.equal(findRunLink(h.db, same.runId)!.parentRun, old.runId);
  const t = await h.call("automations.test", { automationId: id, version: 1 }, alice);
  assert.equal(findRunLink(h.db, t.runId)!.version, 1);
  await refused(h.call("automations.test", { automationId: id, version: 9 }, alice), "validation.not_found", "no_version");
});

// ---- Promote and its access diff ----

const sub = { id: "vit_sub1", kind: "ai_subscription", handle: "#Claude_Max", name: "Claude Max" };
const promotable = (): Record<string, unknown> => create({
  definition: {
    triggers: [{ key: "record_change", filter: { type: "contact" } }],
    nodes: [
      node("find", "records.find", { type: "contact", filter: { id: "rec_read1" } }, { next: ["mail"] }),
      node("mail", "send_email", { to: "a@example.com", subject: "Hi", body: "Sent with #Resend_Key and #Resend_Key.", mailboxId: "mbx_main" }, { next: ["upd"] }),
      node("upd", "records.update", { type: "contact", recordId: "rec_abc", patch: { status: "x" }, via: "con_google1" }, { next: ["ask"] }),
      node("ask", "ai", { prompt: "Write a note" }, { ai: { keyId: "vit_sub1", backupKeyId: "vit_api9" } }),
    ],
  },
});

test("Promote shows what the Space Automation will hold, and which subscription keys must be replaced", async () => {
  const h = harness({ authorize: (_who, a, r) => a.level === "edit" && r.id === "rec_abc" });
  h.callee("vault.items.list", () => ({ items: [sub] }));
  const id = (await h.call("automations.create", promotable(), alice)).automation.id as string;
  const p = await h.call("automations.preview_promote", { automationId: id }, alice);
  assert.equal(p.ready, false);
  assert.deepEqual(p.diff.vaultNames, ["#Resend_Key"]);
  assert.deepEqual(p.diff.connections, ["con_google1"]);
  assert.deepEqual(p.diff.keysToReplace.map((k: { stepId: string; keyId: string }) => `${k.stepId}:${k.keyId}`), ["ask:vit_sub1"]);
  const by = Object.fromEntries(p.diff.grants.map((g: { resource: string; level: string; via: string }) => [g.resource, `${g.level}/${g.via}`]));
  assert.deepEqual(by, {
    "record/rec_abc": "edit/owner_access",
    "record/rec_read1": "view/new_grant",
    "mailbox/mbx_main": "use/new_grant",
  });
});

test("Promote refuses until the subscription keys are replaced, then makes a Space Automation owned by the named person", async () => {
  const h = harness({ authorize: () => false });
  h.callee("vault.items.list", () => ({ items: [sub] }));
  const id = (await h.call("automations.create", promotable(), alice)).automation.id as string;
  await refused(h.call("automations.promote", { automationId: id, confirm: true }, alice), "validation.precondition_failed", "keys_not_replaced");
  assert.equal((await h.call("automations.get", { automationId: id }, alice)).automation.kind, "personal");

  const r = await h.call("automations.promote", { automationId: id, confirm: true, ownerId: bob.id, replaceKeys: [{ stepId: "ask", keyId: "vit_shared1" }] }, alice);
  assert.equal(r.automation.kind, "space");
  assert.equal(r.automation.ownerId, bob.id);
  assert.equal(r.automation.version, 2, "the key change is a new version");
  const ask = r.automation.definition.nodes.find((n: { id: string }) => n.id === "ask");
  assert.deepEqual(ask.ai, { keyId: "vit_shared1", backupKeyId: "vit_api9" }, "only the subscription key is replaced");
  assert.equal(r.diff.grants.length, 3);
  assert.deepEqual(h.events.map((e) => e.name), ["automation.promoted"]);
  assert.deepEqual(h.events[0]!.payload, { automationId: id, ownerId: bob.id, grants: 3, keysReplaced: 1 });
  const versions = (await h.call("automations.versions", { automationId: id }, alice)).versions;
  assert.deepEqual(versions.map((v: { n: number }) => v.n), [2, 1], "history and versions are kept");
  assert.equal(versions[0].reason, "Promoted to the Space: shared keys");
  await refused(h.call("automations.promote", { automationId: id, confirm: true }, alice), "validation.precondition_failed", "already_space");
});

test("a promoted Automation runs as its own Service principal with only the vault names it was confirmed with", async () => {
  const h = harness();
  const id = (await h.call("automations.create", create({ definition: { triggers: trig, nodes: [node("m", "send_email", { to: "a@example.com", subject: "s", body: "Key #Resend_Key", mailboxId: "mbx_main" })] } }), alice)).automation.id as string;
  await h.call("automations.set_enabled", { automationId: id, enabled: true }, alice);
  const personal = await h.call("automations.run", { automationId: id }, alice);
  assert.deepEqual(loadRunPlan({ db: h.db }, personal.runId)!.link.principal, { kind: "person", id: alice.id });
  assert.deepEqual(loadRunPlan({ db: h.db }, personal.runId)!.vault, [], "a Personal Automation uses its owner's own access");

  await h.call("automations.promote", { automationId: id, confirm: true, ownerId: bob.id }, alice);
  const space = await h.call("automations.run", { automationId: id }, bob);
  const plan = loadRunPlan({ db: h.db }, space.runId)!;
  assert.deepEqual(plan.link.principal, { kind: "service", id: `svc_${id.slice(4)}` });
  assert.deepEqual(plan.vault, ["#Resend_Key"]);
});

test("a Personal copy of a Space Automation runs with only the copier's access", async () => {
  const h = harness({ authorize: (who, a) => who.id === bob.id && a.level === "view" });
  const id = (await h.call("automations.create", create(), alice)).automation.id as string;
  await h.call("automations.promote", { automationId: id, confirm: true }, alice);
  const r = await h.call("automations.make_personal_copy", { automationId: id }, bob);
  assert.equal(r.automation.kind, "personal");
  assert.equal(r.automation.ownerId, bob.id);
  assert.equal(r.automation.name, "Welcome new contacts (copy)");
  assert.equal(r.automation.status, "draft");
  assert.notEqual(r.automation.id, id);
  assert.deepEqual(r.automation.definition, goodDefinition());
  assert.deepEqual(h.events.map((e) => e.name), ["automation.copied", "automation.created"]);
  assert.deepEqual(h.events[0]!.payload, { automationId: r.automation.id, fromId: id });
  const named = await h.call("automations.make_personal_copy", { automationId: id, name: "Mine" }, bob);
  assert.equal(named.automation.name, "Mine");
  await refused(h.call("automations.make_personal_copy", { automationId: r.automation.id }, bob), "validation.precondition_failed", "not_space");
});
