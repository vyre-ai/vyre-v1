// The generated catalog, tool_search and the shape of a tool call (ARCH 6.7). The tool count follows generated/mcp-tools.json.
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { HostError, makeError } from "../../host/src/routes/errors.ts";
import { buildCatalog, createToolSession } from "../src/tools/index.ts";
import type { McpToolRow, RegistryCapRow } from "../src/tools/index.ts";
import { ctx, loadGenerated, makeSession, thread } from "../src/tools/harness.ts";

test("catalog: every generated tool joins its capability; the frozen default list is 65 real tools", () => {
  const { catalog, defaults, caps } = loadGenerated();
  // Every generated tool joins the catalog, so the count follows the generated file instead of a literal that each contract change breaks.
  const generated = JSON.parse(readFileSync(new URL("../../generated/mcp-tools.json", import.meta.url), "utf8")) as { tools: unknown[] };
  assert.equal(catalog.all.length, generated.tools.length);
  assert.equal(defaults.size, 65);
  for (const n of defaults) assert.ok(catalog.byName(n), `default tool ${n} exists`);
  for (const t of catalog.all) assert.ok(caps.has(t.cap), t.name);
  const stricter = catalog.all.filter((t) => t.effects === "outward").length;
  // 77 until rc.8 added twelve gated outward tools: Dropbox files (create_folder, delete, restore, upload), Google Docs insert/replace text, mounts doc/sheet edits and Excel workbook writes.
  assert.equal(stricter, 90);  // campaigns_launch left with Campaigns; mcp_call (a connection's tool called from a CLI engine, l-skills1) is gated outward; google_gmail_delete_draft (l-chrome2a) is too
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
  assert.equal(set.listed.length, 65 - loaded.catalog.all.filter((t) => loaded.defaults.has(t.name) && t.toolset === "engineer").length);
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

const LEAK = /\b(?:[a-z]{2,6}_[a-z0-9]{8,}|[0-9a-f]{16,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b|\b500\b/i;

test("no tool error a model receives carries a trace id, an internal id or a bare 500; the full error with its trace stays beside it for the Details", async () => {
  const loaded = loadGenerated();
  const TRACE = "6bc64f781807dd96d50562e8114b4df5";
  const failures: Array<() => never> = [
    () => { throw new TypeError("Cannot read properties of undefined (reading 'length') at thr_01a1a392662d48efb1762dffc795f3a3"); },
    () => { throw new HostError(makeError("validation.not_found", TRACE, { message: "Record rec_01a1a392662d48efb1762dffc795f3a3 is not here.", details: { recordId: "rec_01a1a392662d48efb1762dffc795f3a3" }, next: [{ kind: "ask_access", label: "Ask for access to rec_01a1a392662d48efb1762dffc795f3a3", action: { cap: "access.request" as never, input: { id: "x" } } }] })); },
    () => { throw new HostError(makeError("permission.no_grant", TRACE)); },
    () => { throw new HostError(makeError("internal.unexpected", TRACE, { message: "Something went wrong on our side.", details: { traceId: TRACE } })); },
  ];
  for (const f of failures) {
    const session = createToolSession({ catalog: loaded.catalog, defaults: loaded.defaults, levelFor: () => "manage", traceId: () => TRACE, invoke: async () => f() });
    const out = await session.call(ctx(), "memory_search", { q: "notes" });
    assert.equal(out.kind, "error");
    if (out.kind !== "error") continue;
    const seen = JSON.stringify(out.result.content);
    assert.ok(!LEAK.test(seen), `the model would read: ${seen}`);
    assert.ok(!seen.includes(TRACE), "no trace in what the model reads");
    assert.match(out.error.traceId, /^[0-9a-f]{16,}$/, "the full error keeps its trace for the Details");
  }
});

test("a crash inside the server reaches the agent as a plain sentence naming the tool and what to do", async () => {
  const loaded = loadGenerated();
  const session = createToolSession({ catalog: loaded.catalog, defaults: loaded.defaults, levelFor: () => "manage", traceId: () => "trace_fixed", invoke: async () => { throw new TypeError("boom"); } });
  const out = await session.call(ctx(), "memory_search", { q: "notes" });
  const content = out.kind === "error" ? (out.result.content as { error: { code: string; message: string } }).error : null;
  assert.equal(content?.code, "internal.unexpected");
  assert.match(content?.message ?? "", /memory_search could not finish on the server just now, and nothing was changed/);
  assert.match(content?.message ?? "", /Do not paste ids or traces/);
});

test("an unknown tool is a validation error and never reaches invoke", async () => {
  const { session, calls } = makeSession();
  const out = await session.call(ctx(), "does_not_exist", {});
  assert.equal(out.kind === "error" && out.error.code, "validation.unknown_capability");
  assert.equal(calls.length, 0);
});


test("a probe call is refused before anything runs: example.com, a bare test and __probe_none__ reach no capability and come back with the plain refusal; a real call still works", async () => {
  const loaded = loadGenerated();
  const invoked: string[] = [];
  const session = createToolSession({ catalog: loaded.catalog, defaults: loaded.defaults, levelFor: () => "manage", traceId: () => "trace_fixed", invoke: async (cap) => { invoked.push(cap); return { status: "ok", output: {}, traceId: "t" } as never; } });
  const probes: Array<[string, unknown]> = [
    ["records_get", { recordId: "__probe_none__" }],
    ["ask_question", { prompt: "test", mode: "free" }],
    ["ask_question", { prompt: "Is example.com the right site for the firm?", mode: "free" }],
    ["mail_send", { to: ["client@example.com"], subject: "Retainer", body: "Dear Lee." }],
    ["records_create", { type: "lead", fields: { name: "foo" } }],
  ];
  for (const [tool, input] of probes) {
    const out = await session.call(ctx(), tool, input);
    assert.equal(out.kind, "error", `${tool} ${JSON.stringify(input)}`);
    if (out.kind !== "error") continue;
    assert.equal(out.error.code, "validation.bad_input");
    assert.match(out.error.message, /Don't call tools to test them\. Call with the real thing the person asked for, or don't call\./);
  }
  assert.deepEqual(invoked, [], "nothing reached a capability: no card, hold, task or message");
  const real = await session.call(ctx(), "records_get", { type: "lead", recordId: "rec_01a1a392662d48efb1762dffc795f3a3" });
  assert.equal(real.kind, "result");
  assert.deepEqual(invoked, ["records.get"]);
});

test("a value the person typed themselves passes the probe guard; the same value invented by the agent is refused", async () => {
  const loaded = loadGenerated();
  const invoked: string[] = [];
  const session = createToolSession({ catalog: loaded.catalog, defaults: loaded.defaults, levelFor: () => "manage", traceId: () => "trace_fixed", invoke: async (cap) => { invoked.push(cap); return { status: "ok", output: {}, traceId: "t" } as never; } });
  const input = { type: "lead", fields: { name: "test", site: "https://example.com" } };
  const invented = await session.call(ctx(), "records_create", input);
  assert.equal(invented.kind, "error", "the agent made it up: refused");
  assert.deepEqual(invoked, []);
  const asked = await session.call(ctx({ said: "Please make a lead called test and use https://example.com as its site" }), "records_create", input);
  assert.equal(asked.kind, "result", "the person asked for exactly that: it runs");
  assert.deepEqual(invoked, ["records.create"]);
  // the person asked for one of the two values only: the other is still the agent's invention
  invoked.length = 0;
  const half = await session.call(ctx({ said: "make a lead called test" }), "records_create", input);
  assert.equal(half.kind, "error");
  assert.deepEqual(invoked, []);
});

test("what a model reads from a failed tool says approval, never Gate or hold", async () => {
  const loaded = loadGenerated();
  const session = createToolSession({
    catalog: loaded.catalog, defaults: loaded.defaults, levelFor: () => "manage", traceId: () => "trace_fixed",
    invoke: async () => { throw new HostError(makeError("permission.needs_approval", "tr_x", { message: "This send is held at the Gate. The hold waits for a person." })); },
  });
  const out = await session.call(ctx(), "mail_send", { to: ["maya@northwind.com"], subject: "Retainer", body: "Dear Maya, the retainer is attached." });
  assert.equal(out.kind, "error");
  if (out.kind !== "error") return;
  const seen = JSON.stringify(out.result.content);
  assert.ok(!/\bGate\b|\bholds?\b/i.test(seen), seen);
  assert.match(seen, /approval/);
});

// Times in a calendar, mail, inbox or task result are said in the person's zone too (the owner's Assistant worked a meeting's day out from epoch numbers and got it wrong).
test("a result of a timed capability carries <key>Local in the asker's zone; another capability's result is untouched; no known zone means no change", async () => {
  const g = loadGenerated();
  const output = { event: { start: "2026-11-05T22:00:00Z", title: "Call" }, items: [{ createdAt: 1_793_916_000_000 }] };
  const make = (zone: string | undefined) => createToolSession({
    catalog: g.catalog, defaults: new Set([...g.defaults, "calendar_list_calendars", "agents_list"]), levelFor: () => null, canEngineer: () => false, traceId: () => "t",
    ...(zone ? { zoneOf: () => zone } : {}),
    invoke: async () => ({ status: "ok", output, traceId: "t" }),
  });
  const dataOf = async (zone: string | undefined, tool: string) => ((await make(zone).call(ctx(), tool, {})).result.content as { data: typeof output & { event: Record<string, string> } }).data;
  const shown = await dataOf("Asia/Karachi", "calendar_list_calendars");
  assert.equal(shown.event["startLocal"], "Friday 6 November 2026, 03:00 (Asia/Karachi, UTC+5)");
  assert.equal(shown.event["start"], "2026-11-05T22:00:00Z");
  assert.match((shown.items[0] as unknown as Record<string, string>)["createdAtLocal"]!, /^Friday 6 November 2026/);
  assert.equal((await dataOf(undefined, "calendar_list_calendars")).event["startLocal"], undefined, "no zone known: the result is as it was");
  assert.equal((await dataOf("Asia/Karachi", "agents_list")).event["startLocal"], undefined, "agents are not a timed capability");
});
