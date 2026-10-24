// The generated catalog, tool_search and the shape of a tool call (ARCH 6.7). The tool count follows generated/mcp-tools.json.
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { HostError, makeError } from "../../host/src/routes/errors.ts";
import { buildCatalog, createToolSession } from "../src/tools/index.ts";
import type { McpToolRow, RegistryCapRow } from "../src/tools/index.ts";
import { ctx, loadGenerated, makeSession, thread } from "../src/tools/harness.ts";

test("catalog: every generated tool joins its capability; the frozen default list is 59 real tools", () => {
  const { catalog, defaults, caps } = loadGenerated();
  // Every generated tool joins the catalog, so the count follows the generated file instead of a literal that each contract change breaks.
  const generated = JSON.parse(readFileSync(new URL("../../generated/mcp-tools.json", import.meta.url), "utf8")) as { tools: unknown[] };
  assert.equal(catalog.all.length, generated.tools.length);
  assert.equal(defaults.size, 59);
  for (const n of defaults) assert.ok(catalog.byName(n), `default tool ${n} exists`);
  for (const t of catalog.all) assert.ok(caps.has(t.cap), t.name);
  const stricter = catalog.all.filter((t) => t.effects === "outward").length;
  assert.equal(stricter, 77);
});

test("catalog: a tool whose capability is missing, or a duplicate name, is a build error not a quiet gap", () => {
  const cap: RegistryCapRow = { name: "a.b", v: 1, level: "view", effects: "read" };
  const tool: McpToolRow = { name: "a_b", cap: "a.b", v: 1, toolset: "meta", description: "x", inputSchema: {}, effects: "read", planMode: "allowed", deferred: false };
  assert.equal(buildCatalog([cap], [tool]).all.length, 1);
  assert.throws(() => buildCatalog([], [tool]), /not in the registry/);
  assert.throws(() => buildCatalog([cap], [tool, tool]), /duplicate/);
  assert.throws(() => buildCatalog([cap], [{ ...tool, cap: null }]), /no capability/);
  // the stricter effects label wins so a tool never looks safer than its capability
  assert.equal(buildCatalog([{ ...cap, effects: "outward" }], [tool]).all[0]?.effects, "outward");
});

test("the default listed set loads every turn (about 60); the rest are found with tool_search and then callable", async () => {
  const { session, loaded } = makeSession();
  const set = session.toolsFor(ctx());
  assert.equal(set.listed.length, 59 - loaded.catalog.all.filter((t) => loaded.defaults.has(t.name) && t.toolset === "engineer").length);
  assert.ok(set.searchable.length > 500);
  const notDefault = loaded.catalog.all.find((t) => !loaded.defaults.has(t.name) && t.effects === "read" && t.toolset !== "engineer");
  assert.ok(notDefault);
  const early = await session.call(ctx(), notDefault.name, {});
  assert.equal(early.kind === "error" && early.error.code, "validation.precondition_failed");
  assert.equal(early.kind === "error" && early.error.details?.["reason"], "not_loaded");

  const found = await session.call(ctx(), "tool_search", { query: notDefault.name });
  assert.equal(found.kind, "result");
  if (found.kind === "result") {
    const tools = (found.result.content as { data: { tools: Array<{ name: string; inputSchema: unknown }> } }).data.tools;
    const hit = tools.find((t) => t.name === notDefault.name);
    assert.ok(hit, "the schema comes back with the name");
    assert.ok(hit.inputSchema !== undefined);
  }
  assert.equal((await session.call(ctx(), notDefault.name, {})).kind, "result");
  session.forget("T1");
  assert.equal((await session.call(ctx(), notDefault.name, {})).kind, "error", "a new thread session starts with nothing loaded");
});

test("tool_search is scoped to what the asker may use, and needs a query", async () => {
  const { session } = makeSession({ levels: { "per_dana:record:rec_1": "view" } });
  const c = ctx({ thread: thread({ kind: "ask", scope: { type: "record", id: "rec_1" } }) });
  const hits = session.search(c, "update record field");
  assert.ok(hits.every((t) => t.effects === "read" || t.cap === "access.propose_change"), "no write tool is revealed to a view-only pane");
  const bad = await session.call(c, "tool_search", {});
  assert.equal(bad.kind === "error" && bad.error.code, "validation.bad_input");
});

test("agent allow and deny lists narrow the set; deny wins; a toolset name works", async () => {
  const { session } = makeSession();
  const denied = ctx({ rules: { deny: ["terminal", "files_write"] } });
  const names = new Set(session.toolsFor(denied).listed.map((t) => t.name));
  assert.ok(!names.has("terminal_run") && !names.has("files_write") && names.has("files_read"));
  assert.equal((await session.call(denied, "terminal_run", {})).kind, "error");
  const only = ctx({ rules: { allow: ["records"], deny: ["records_update"] } });
  const set = session.toolsFor(only);
  assert.ok(set.listed.every((t) => t.toolset === "records" && t.name !== "records_update"));
  assert.ok(set.listed.length > 0);
});

test("the engineer toolset is never offered without engineer.mcp", async () => {
  const off = makeSession();
  const on = makeSession({ engineer: true });
  const all = (s: ReturnType<typeof makeSession>) => { const x = s.session.toolsFor(ctx()); return [...x.listed, ...x.searchable]; };
  assert.ok(all(off).every((t) => t.toolset !== "engineer"));
  assert.ok(all(on).some((t) => t.toolset === "engineer"));
  const out = await off.session.call(ctx(), "access_actors_create", {});
  assert.equal(out.kind === "error" && out.error.code, "permission.role_lacks_permission");
});

test("the seed names the agent as principal, the asker as who it acts for, and carries thread, run and provider", async () => {
  const seeds: unknown[] = [];
  const loaded = loadGenerated();
  const session = createToolSession({
    catalog: loaded.catalog, defaults: loaded.defaults, levelFor: () => "manage",
    invoke: async (_cap, _input, seed) => { seeds.push(seed); return { status: "ok", output: { id: "rec_1" }, traceId: "tr_1" }; },
  });
  const out = await session.call(ctx({ runId: "run_9", provider: "anthropic", trace: { traceId: "tr_a", spanId: "sp_a" } }), "records_get", { id: "rec_1" });
  assert.equal(out.kind, "result");
  assert.deepEqual(seeds[0], {
    space: "spc_1", principal: { kind: "agent", id: "agt_intake" }, actingFor: "per_dana", trace: { traceId: "tr_a", spanId: "sp_a" },
    run: "run_9", thread: "T1", origin: "agent", provider: "anthropic", approval: undefined,
  });
  if (out.kind === "result") assert.deepEqual(out.result, { ok: true, content: { data: { id: "rec_1" } } });
});

test("results carry the block types the tool renders as", async () => {
  const { session } = makeSession();
  const out = await session.call(ctx(), "ask_question", {});
  assert.equal(out.kind, "result");
  if (out.kind === "result") assert.deepEqual((out.result.content as { blocks?: string[] }).blocks, ["question"]);
});

test("errors from invoke come back as tool errors with their code; an unexpected throw never leaks its message", async () => {
  const loaded = loadGenerated();
  let mode: "denied" | "boom" = "denied";
  const session = createToolSession({
    catalog: loaded.catalog, defaults: loaded.defaults, levelFor: () => "manage",
    invoke: async () => {
      if (mode === "denied") throw new HostError(makeError("permission.no_grant", "tr_x", { next: [{ kind: "ask_access", label: "Ask for access" }] }));
      throw new Error("secret connection string postgres://u:p@host");
    },
  });
  const a = await session.call(ctx(), "records_get", {});
  assert.equal(a.kind === "error" && a.error.code, "permission.no_grant");
  assert.equal(a.kind === "error" && a.result.ok, false);
  mode = "boom";
  const b = await session.call(ctx(), "records_get", {});
  assert.equal(b.kind === "error" && b.error.code, "internal.unexpected");
  assert.ok(!JSON.stringify(b).includes("postgres://"));
});

test("an unknown tool is a validation error and never reaches invoke", async () => {
  const { session, calls } = makeSession();
  const out = await session.call(ctx(), "does_not_exist", {});
  assert.equal(out.kind === "error" && out.error.code, "validation.unknown_capability");
  assert.equal(calls.length, 0);
});
