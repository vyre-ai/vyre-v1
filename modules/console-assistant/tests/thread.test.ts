// The Console assistant thread, its Engineer toolset and Explain access through the real handlers (spec 3.10, ARCH 7.10).
// contract tests for the toolset: the toolset is filtered by the person's role.
// @reads /generated/registry.json
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handlers } from "../impl.ts";
import { ALL_PERMS, codeOf, harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";

interface RegCap { name: string; permission: string | null; surfaces?: { mcp?: { toolset?: string } | false } }
const registry = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as { capabilities: RegCap[] };
const engineer = registry.capabilities.filter((c) => c.surfaces?.mcp && c.surfaces.mcp.toolset === "engineer");

const BOSS = "usr_boss";
const ASSISTANT = "agt_asst";
const world = (allow: string[] = ALL_PERMS): Harness =>
  harness({
    "agents.list": { agents: [{ agentId: "agt_other", ownerId: BOSS, role: "worker" }, { agentId: ASSISTANT, ownerId: BOSS, role: "assistant" }, { agentId: "agt_theirs", ownerId: "usr_x", role: "assistant" }] },
    "chat.start": { threadId: "thr_console1" },
    "threads.update": { threadId: "thr_console1" },
  }, allow);

test("the Engineer toolset lists every Engineer capability when the person holds every permission", async () => {
  const h = world();
  const out = await handlers["console.assistant_tools"](h.as(BOSS), {});
  assert.equal(out.tools.length, engineer.length);
  assert.deepEqual(out.tools.map((t) => t.name), out.tools.map((t) => t.name).sort((a, b) => a.localeCompare(b)), "sorted by name");
  assert.ok(out.tools.every((t) => t.summary.length > 0));
  assert.ok(out.tools.some((t) => t.name === "console.diff_apply"));
});

test("the toolset is filtered by the person's role: a Developer sees schema and logs and no people management", async () => {
  const developer = ["console.access", "engineer.mcp", "schema.manage", "connectors.manage", "server.logs"];
  const out = await handlers["console.assistant_tools"](world(developer).as("usr_dev"), {});
  const names = new Set(out.tools.map((t) => t.name));
  const held = new Set(developer);
  for (const c of engineer) assert.equal(names.has(c.name), c.permission === null || held.has(c.permission), `${c.name} (${c.permission ?? "no permission"})`);
  assert.ok(names.has("schema.apply"));
  assert.ok(!names.has("access.roles.update"), "access.manage is not held");
  assert.ok(!names.has("access.policies.set"), "policy.manage is not held");
  assert.ok(out.tools.length < engineer.length);
});

test("a person with no Engineer permissions sees only tools that grants decide at call time", async () => {
  const out = await handlers["console.assistant_tools"](world([]).as("usr_nobody"), {});
  const open = engineer.filter((c) => c.permission === null).map((c) => c.name).sort((a, b) => a.localeCompare(b));
  assert.deepEqual(out.tools.map((t) => t.name), open);
});

test("assistant_open starts the person's own assistant once and follows the page afterwards", async () => {
  const h = world();
  const first = await handlers["console.assistant_open"](h.as(BOSS), { page: "access.roles", objectRef: "rol_a1b2c3", idempotencyKey: "idem_1" });
  assert.deepEqual(first, { threadId: "thr_console1" });
  const start = h.calls.filter((c) => c.cap === "chat.start");
  assert.equal(start.length, 1);
  assert.deepEqual(start[0]!.input["agentIds"], [ASSISTANT], "the assistant role wins over another personal agent, and another person's assistant is never used");
  assert.equal(start[0]!.input["scopeType"], "console");
  assert.equal(start[0]!.input["first"], "Console page: access.roles (rol_a1b2c3)");
  const row = h.raw.rows("console_assistant_thread")[0]!;
  assert.deepEqual([row["person_id"], row["thread_id"], row["assistant_id"], row["page"], row["object_ref"]], [BOSS, "thr_console1", ASSISTANT, "access.roles", "rol_a1b2c3"]);

  const again = await handlers["console.assistant_open"](h.as(BOSS), { page: "console.speed", idempotencyKey: "idem_2" });
  assert.deepEqual(again, first, "the same thread");
  assert.equal(h.calls.filter((c) => c.cap === "chat.start").length, 1, "no second chat");
  const after = h.raw.rows("console_assistant_thread")[0]!;
  assert.deepEqual([after["page"], after["object_ref"]], ["console.speed", null]);
  assert.deepEqual(h.calls.filter((c) => c.cap === "threads.update").map((c) => c.input["title"]), ["Console: console.speed"]);
});

test("an agent acting for the person opens the person's thread", async () => {
  const h = world();
  await handlers["console.assistant_open"](h.as(ASSISTANT, "agent", BOSS), { page: "console.overview", idempotencyKey: "idem_1" });
  assert.equal(h.raw.rows("console_assistant_thread")[0]!["person_id"], BOSS);
  await assert.rejects(handlers["console.assistant_open"](h.as("agt_loose", "agent"), { page: "x", idempotencyKey: "idem_2" }), (e: unknown) => codeOf(e) === "permission.no_grant");
});

test("without an assistant the pane gets a clear precondition error and no thread row", async () => {
  const h = harness({ "agents.list": { agents: [{ agentId: "agt_theirs", ownerId: "usr_x", role: "assistant" }] } });
  await assert.rejects(handlers["console.assistant_open"](h.as(BOSS), { page: "console.overview", idempotencyKey: "idem_1" }), (e: unknown) => codeOf(e) === "validation.precondition_failed");
  assert.equal(h.raw.rows("console_assistant_thread").length, 0);
  assert.equal(h.calls.some((c) => c.cap === "chat.start"), false);
});

test("context_set follows the page for the owner only, and a title that cannot update does not fail the call", async () => {
  const h = world();
  const { threadId } = await handlers["console.assistant_open"](h.as(BOSS), { page: "console.overview", idempotencyKey: "idem_1" });
  assert.deepEqual(await handlers["console.assistant_context_set"](h.as(BOSS), { threadId, page: "access.people", objectRef: "usr_x" }), { ok: true });
  const row = h.raw.rows("console_assistant_thread")[0]!;
  assert.deepEqual([row["page"], row["object_ref"]], ["access.people", "usr_x"]);

  await assert.rejects(handlers["console.assistant_context_set"](h.as("usr_other"), { threadId, page: "x" }), (e: unknown) => codeOf(e) === "validation.not_found");
  await assert.rejects(handlers["console.assistant_context_set"](h.as(BOSS), { threadId: "thr_nope", page: "x" }), (e: unknown) => codeOf(e) === "validation.not_found");

  h.answers.set("threads.update", new Error("chat is down"));
  assert.deepEqual(await handlers["console.assistant_context_set"](h.as(BOSS), { threadId, page: "audit.log" }), { ok: true });
  assert.equal(h.raw.rows("console_assistant_thread")[0]!["page"], "audit.log");
  assert.deepEqual(h.warnings, ["console assistant could not retitle its thread"]);
});

test("explain_access uses the Access checker's own words, with a level or a permission", async () => {
  const h = harness({
    "access.check": (i: Record<string, unknown>) => ({ decision: { effect: "deny", reason: "no grant", decisionId: "dec_1", steps: [{ ok: true, text: "Omar is a Member" }, { ok: false, text: "No grant on Rivera" }] }, echo: i }),
  });
  const out = await handlers["console.explain_access"](h.as(BOSS), { person: "usr_omar", action: "view", resourceType: "record", resourceId: "rec_rivera" });
  assert.deepEqual(out, { effect: "deny", steps: ["Omar is a Member", "No grant on Rivera"] });
  const asked = h.calls[0]!.input;
  assert.deepEqual(asked["principal"], { kind: "person", id: "usr_omar" });
  assert.deepEqual(asked["action"], { level: "view" });
  assert.deepEqual(asked["resource"], { type: "record", id: "rec_rivera" });

  await handlers["console.explain_access"](h.as(BOSS), { person: "usr_omar", action: "records.export", resourceType: "space", resourceId: "spc_test" });
  assert.deepEqual(h.calls[1]!.input["action"], { perm: "records.export", level: "view" });
});

test("explain_access falls back to the reason when the checker lists no steps, and refuses an empty answer", async () => {
  const h = harness({ "access.check": { decision: { effect: "allow", reason: "owner", decisionId: "dec_1", steps: [] } } });
  assert.deepEqual(await handlers["console.explain_access"](h.as(BOSS), { person: "usr_a", action: "edit", resourceType: "space", resourceId: "spc_test" }), { effect: "allow", steps: ["owner"] });
  h.answers.set("access.check", {});
  await assert.rejects(handlers["console.explain_access"](h.as(BOSS), { person: "usr_a", action: "edit", resourceType: "space", resourceId: "spc_test" }), (e: unknown) => codeOf(e) === "internal.unexpected");
});
