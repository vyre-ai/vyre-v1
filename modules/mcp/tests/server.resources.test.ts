// Resources and prompts (lane r42-mcp, 19 Nov 2026): the things in a Space as vyre:// addresses and its skills as prompts, for an app connected from outside. An address is another name for a read tool,
// so every read here goes through the same pipeline as a tool call: as the agent acting for its person, refused where a tool call is refused, and a thing the caller may not see is "not found".
import test from "node:test";
import assert from "node:assert/strict";
import { createMcpServer } from "../../../agent/src/mcp/index.ts";
import type { McpCaller } from "../../../agent/src/mcp/index.ts";
import {
  RESOURCE_TEMPLATES,
  completionsOf,
  listedResources,
  promptOf,
  promptsOf,
  routeOf,
} from "../../../agent/src/mcp/resources.ts";
import { loadGenerated } from "../../../agent/src/tools/harness.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import type { Invoke } from "../../../host/src/invoke.ts";

const g = loadGenerated();
const V = "2026-07-28";
const outside: McpCaller = {
  kind: "outside",
  sessionId: "ses_out",
  space: "spc_1",
  principal: { kind: "agent", id: "agt_cc" },
  actingFor: "usr_imran",
};
const driver: McpCaller = {
  kind: "driver",
  sessionId: "ses_drv",
  space: "spc_1",
  principal: { kind: "agent", id: "agt_intake" },
  actingFor: "usr_imran",
  threadId: "thr_1",
};

/** What the Space holds, as the read capabilities answer. Anything not here is not found; `rec_secret` is there and this caller may not see it. */
const SPACE: Record<string, (input: any) => unknown> = {
  "schema.types.list": () => ({
    types: [
      {
        key: "company",
        title: "Company",
        plural: "Companies",
        label: "public",
        fieldCount: 6,
        rowCount: 12,
        system: false,
      },
      {
        key: "contact",
        title: "Contact",
        plural: "Contacts",
        label: "public",
        fieldCount: 5,
        rowCount: 40,
        system: true,
      },
    ],
    total: 2,
  }),
  "files.recent": () => ({
    files: [
      {
        fileId: "fil_pricing",
        name: "pricing.md",
        mime: "text/markdown",
        size: 812,
        kind: "text",
        updatedAt: 1760000000000,
      },
      { fileId: "fil_logo", name: "logo.png", mime: "image/png", size: 2048, kind: "image", updatedAt: 1760000100000 },
    ],
  }),
  "documents.templates.list": () => ({
    templates: [
      { fileId: "fil_offer", name: "Offer letter", fields: 4, folderId: "fld_tpl", updatedAt: 1760000000000 },
    ],
    total: 1,
  }),
  "records.get": (i) => {
    if (i.recordId === "rec_harbor")
      return {
        record: { id: "rec_harbor", type: "company", fields: { name: "Harbor Studio", stage: "Won" }, version: 3 },
      };
    throw fail(i.recordId === "rec_secret" ? "permission.no_grant" : "validation.not_found", "t".repeat(32), {});
  },
  "files.read": (i) => {
    if (i.fileId === "fil_pricing")
      return { text: "# Pricing\n12 per unit", mime: "text/markdown", size: 812, version: 2 };
    if (i.fileId === "fil_logo")
      return i.as === "base64"
        ? { base64: "iVBORw0KGgo=", mime: "image/png", size: 2048 }
        : { mime: "image/png", size: 2048 };
    throw fail("validation.not_found", "t".repeat(32), {});
  },
  "skills.list": () => ({
    skills: [
      {
        name: "weekly-report",
        description: "Write this week's report from tasks and records",
        tier: "space",
        source: "upload",
        system: false,
        enabled: true,
        bytes: 900,
      },
      {
        name: "follow-up",
        description: "Draft a follow-up to a company",
        tier: "space",
        source: "upload",
        system: false,
        enabled: true,
        bytes: 400,
      },
      {
        name: "old-one",
        description: "Turned off",
        tier: "space",
        source: "upload",
        system: false,
        enabled: false,
        bytes: 10,
      },
      {
        name: "broken-one",
        description: "Broken",
        tier: "space",
        source: "upload",
        system: false,
        enabled: true,
        bytes: 10,
        broken: "No name",
      },
      {
        name: "follow-up",
        description: "The built-in one, not used",
        tier: "builtin",
        source: "vyre",
        system: true,
        enabled: true,
        bytes: 10,
        shadowedBy: "space",
      },
    ],
  }),
  "skills.load": (i) => {
    if (i.name !== "weekly-report") throw fail("validation.not_found", "t".repeat(32), {});
    return {
      skill: {
        name: "weekly-report",
        description: "Write this week's report from tasks and records",
        tier: "space",
        source: "upload",
        body: "1. Read the tasks closed this week.\n2. Write one page.",
        files: [{ path: "outline.md", text: "Done, Next, Blocked" }],
      },
    };
  },
};

function rig(caller: McpCaller = outside) {
  const seen: Array<{ cap: string; principal: string; actingFor: string | undefined; origin: unknown }> = [];
  const noted: Array<{ tool: string; outcome: string }> = [];
  const invoke: Invoke = async (cap, input, seed) => {
    seen.push({ cap, principal: seed.principal.id, actingFor: seed.actingFor, origin: seed.origin });
    const f = SPACE[cap];
    if (!f) throw fail("validation.not_found", "t".repeat(32), {});
    return { status: "ok", output: f(input), traceId: "t".repeat(32) };
  };
  const server = createMcpServer({
    catalog: g.catalog,
    defaults: g.defaults,
    invoke,
    open: async () => caller,
    onCall: (_c, tool, outcome) => {
      noted.push({ tool, outcome });
    },
  });
  let n = 0;
  /** A 2026-07-28 request. `headers` changes what is sent beside the body. */
  async function ask(method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    const named = method === "resources/read" ? params["uri"] : params["name"];
    const r = await server.handle({
      method: "POST",
      headers: {
        authorization: "Bearer t",
        "mcp-protocol-version": V,
        "mcp-method": method,
        ...(typeof named === "string" ? { "mcp-name": named } : {}),
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++n,
        method,
        params: {
          ...params,
          _meta: { "io.modelcontextprotocol/protocolVersion": V, "io.modelcontextprotocol/clientCapabilities": {} },
        },
      }),
    });
    return { ...r, json: r.body === "" ? null : (JSON.parse(r.body) as any) };
  }
  /** A request of a handshake revision: no `_meta`, no headers to check. */
  async function old(method: string, params?: Record<string, unknown>) {
    const r = await server.handle({
      method: "POST",
      headers: { authorization: "Bearer t" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, ...(params ? { params } : {}) }),
    });
    return { ...r, json: r.body === "" ? null : (JSON.parse(r.body) as any) };
  }
  return { ask, old, seen, noted };
}

test("an address is a read tool and its arguments, and nothing else gets through: no path, no query, no extra part, no made-up id", () => {
  assert.deepEqual(routeOf("vyre://record/company/rec_harbor"), {
    kind: "record",
    tool: "records_get",
    args: { type: "company", recordId: "rec_harbor" },
  });
  assert.deepEqual(routeOf("vyre://records/company"), {
    kind: "records",
    tool: "records_query",
    args: { type: "company", limit: 25, sort: [{ field: "updated_at", dir: "desc" }] },
  });
  assert.deepEqual(routeOf("vyre://file/fil_pricing")?.args, { fileId: "fil_pricing", as: "text" });
  assert.equal(routeOf("vyre://note/not_a1b2")?.tool, "notes_get");
  assert.equal(routeOf("vyre://task/tsk_a1b2")?.tool, "tasks_get");
  assert.deepEqual(routeOf("vyre://tasks/mine")?.args, { scope: "mine", limit: 25 });
  assert.equal(routeOf("vyre://run/run_a1b2")?.tool, "runs_get");
  assert.equal(routeOf("vyre://template/fil_offer")?.tool, "documents_fields");
  assert.equal(routeOf("vyre://skill/weekly-report")?.tool, "skills_view");
  for (const bad of [
    "file:///etc/passwd",
    "vyre://file/../../etc/passwd",
    "vyre://file/fil_a/b",
    "vyre://file/fil_a?as=url",
    "vyre://file/FIL_A",
    "vyre://record/company",
    "vyre://record/Company/rec_a",
    "vyre://record/company/rec_a/extra",
    "vyre://tasks/all",
    "vyre://vault/vlt_a1b2",
    "vyre://file/%E0%A4%A",
    "vyre://",
    `vyre://file/fil_${"a".repeat(600)}`,
    42,
    null,
  ])
    assert.equal(routeOf(bad), null, String(bad));
  // every shape a client can fill in leads to a tool that exists and only reads
  for (const t of RESOURCE_TEMPLATES) {
    const filled = t.uriTemplate
      .replace("{type}", "company")
      .replace("{name}", "weekly-report")
      .replace(/\{[a-zA-Z]+\}/, "fil_a1b2");
    const route = routeOf(filled);
    assert.ok(route, t.uriTemplate);
    assert.equal(g.catalog.byName(route.tool)?.effects, "read", `${route.tool} only reads`);
  }
});

test("resources/list is the caller's own things by name, with how long to keep it; the shapes come from resources/templates/list", async () => {
  const r = rig();
  const list = await r.ask("resources/list");
  assert.equal(list.status, 200, list.body);
  const res = list.json.result;
  assert.equal(res.resultType, "complete");
  assert.equal(res.cacheScope, "private");
  assert.ok(res.ttlMs > 0);
  const uris = (res.resources as Array<{ uri: string }>).map((x) => x.uri);
  for (const u of [
    "vyre://tasks/mine",
    "vyre://types",
    "vyre://records/company",
    "vyre://records/contact",
    "vyre://file/fil_pricing",
    "vyre://file/fil_logo",
    "vyre://template/fil_offer",
  ])
    assert.ok(uris.includes(u), u);
  const pricing = res.resources.find((x: any) => x.uri === "vyre://file/fil_pricing");
  assert.equal(pricing.name, "pricing.md");
  assert.equal(pricing.mimeType, "text/markdown");
  assert.equal(pricing.annotations.lastModified, new Date(1760000000000).toISOString());
  assert.equal(res.resources.find((x: any) => x.uri === "vyre://records/company").title, "Companies");
  for (const x of res.resources) assert.ok(routeOf(x.uri), `${x.uri} can be read`);
  assert.deepEqual(r.noted, [], "the reads a list is built from are not put on the app's activity one by one");
  assert.ok(
    r.seen.every((c) => c.principal === "agt_cc" && c.actingFor === "usr_imran" && c.origin === "mcp"),
    "each read is the agent acting for its person",
  );
  const shapes = await r.ask("resources/templates/list");
  assert.deepEqual(shapes.json.result.resourceTemplates, RESOURCE_TEMPLATES);
  assert.ok(shapes.json.result.ttlMs > 0);
  assert.equal((await r.ask("resources/list", { cursor: "made-up" })).json.error.code, -32602);
  // a read that is refused adds nothing, and the list still answers
  assert.deepEqual(
    listedResources({}).map((x) => x.uri),
    ["vyre://tasks/mine", "vyre://types", "vyre://files/recent", "vyre://templates", "vyre://runs/mine"],
  );
});

test("resources/read is the read tool's answer; a file is its text, a picture its bytes; and it is on the app's activity like a tool call", async () => {
  const r = rig();
  const rec = await r.ask("resources/read", { uri: "vyre://record/company/rec_harbor" });
  assert.equal(rec.status, 200, rec.body);
  assert.equal(rec.json.result.resultType, "complete");
  assert.equal(rec.json.result.ttlMs, 0);
  assert.equal(rec.json.result.cacheScope, "private");
  const [c] = rec.json.result.contents;
  assert.equal(c.uri, "vyre://record/company/rec_harbor");
  assert.equal(c.mimeType, "application/json");
  assert.equal(JSON.parse(c.text).record.fields.name, "Harbor Studio");
  assert.deepEqual(r.noted.at(-1), { tool: "records_get", outcome: "ok" });
  assert.deepEqual(r.seen.at(-1), { cap: "records.get", principal: "agt_cc", actingFor: "usr_imran", origin: "mcp" });

  const file = (await r.ask("resources/read", { uri: "vyre://file/fil_pricing" })).json.result.contents[0];
  assert.deepEqual(file, { uri: "vyre://file/fil_pricing", mimeType: "text/markdown", text: "# Pricing\n12 per unit" });
  const pic = (await r.ask("resources/read", { uri: "vyre://file/fil_logo" })).json.result.contents[0];
  assert.deepEqual(pic, { uri: "vyre://file/fil_logo", mimeType: "image/png", blob: "iVBORw0KGgo=" });
});

test("a thing the caller may not see and a thing that is not there are the same answer, and never an empty read", async () => {
  const r = rig();
  const forbidden = await r.ask("resources/read", { uri: "vyre://record/company/rec_secret" });
  const absent = await r.ask("resources/read", { uri: "vyre://record/company/rec_nothere" });
  for (const out of [forbidden, absent]) {
    assert.equal(out.status, 200);
    assert.equal(out.json.error.code, -32602);
    assert.equal(out.json.error.message, "Resource not found");
    assert.equal(out.json.result, undefined);
  }
  assert.deepEqual(
    { ...forbidden.json.error, data: null },
    { ...absent.json.error, data: null },
    "nothing tells the two apart",
  );
  assert.equal(forbidden.json.error.data.uri, "vyre://record/company/rec_secret");
  // an address of nothing this server has is the same answer, and no read is made for it
  const before = r.seen.length;
  for (const uri of ["vyre://vault/vlt_a1b2", "file:///etc/passwd", "vyre://file/../x"]) {
    const out = await r.ask("resources/read", { uri });
    assert.equal(out.json.error.code, -32602, uri);
  }
  assert.equal(r.seen.length, before);
  // the handshake revisions say it with their own code
  const legacy = await r.old("resources/read", { uri: "vyre://record/company/rec_nothere" });
  assert.equal(legacy.json.error.code, -32002);
});

test("the header that repeats the address is checked against the body before any read", async () => {
  const r = rig();
  const out = await r.ask(
    "resources/read",
    { uri: "vyre://record/company/rec_harbor" },
    { "mcp-name": "vyre://record/company/rec_other" },
  );
  assert.equal(out.status, 400);
  assert.equal(out.json.error.code, -32020);
  assert.equal(r.seen.length, 0);
});

test("the Space's skills are prompts: the ones that are on and work, one per name, and prompts/get is the skill with the person's request", async () => {
  const r = rig();
  const list = await r.ask("prompts/list");
  assert.equal(list.status, 200, list.body);
  assert.deepEqual(
    list.json.result.prompts.map((p: any) => p.name),
    ["follow-up", "weekly-report"],
  );
  assert.equal(
    list.json.result.prompts[0].description,
    "Draft a follow-up to a company",
    "the one that wins, not the one it hides",
  );
  assert.deepEqual(list.json.result.prompts[1].arguments, [
    { name: "request", description: "What you want done", required: false },
  ]);
  assert.ok(list.json.result.ttlMs > 0);
  assert.ok(r.seen.some((c) => c.cap === "skills.list"));

  const got = await r.ask("prompts/get", { name: "weekly-report", arguments: { request: "Keep it to five lines." } });
  assert.equal(got.status, 200, got.body);
  assert.equal(got.json.result.resultType, "complete");
  assert.equal(got.json.result.description, "Write this week's report from tasks and records");
  const [m] = got.json.result.messages;
  assert.equal(m.role, "user");
  assert.equal(m.content.type, "text");
  assert.match(m.content.text, /Read the tasks closed this week/);
  assert.match(m.content.text, /File outline\.md:\nDone, Next, Blocked/);
  assert.match(m.content.text, /Request: Keep it to five lines\.$/);
  assert.deepEqual(r.noted.at(-1), { tool: "load_skill", outcome: "ok" });

  for (const name of ["no-such-skill", "../etc", "has space"]) {
    const bad = await r.ask("prompts/get", { name });
    assert.equal(bad.json.error.code, -32602, String(name));
  }
  assert.deepEqual(promptsOf({ skills: [] }), []);
  assert.equal(promptOf({ skill: { name: "x" } }, undefined), null, "a skill with no instructions is no prompt");
});

test("a record type can be finished as it is typed, from the types this caller may list", async () => {
  const r = rig();
  const out = await r.ask("completion/complete", {
    ref: { type: "ref/resource", uri: "vyre://records/{type}" },
    argument: { name: "type", value: "co" },
  });
  assert.equal(out.status, 200, out.body);
  assert.deepEqual(out.json.result.completion, { values: ["company", "contact"], total: 2, hasMore: false });
  assert.deepEqual(completionsOf({ type: "ref/prompt", name: "weekly-report" }, { name: "request", value: "x" }, {}), {
    values: [],
    total: 0,
    hasMore: false,
  });
});

test("the handshake revisions get the same resources and prompts in their own shape, and say so when they open", async () => {
  const r = rig();
  const init = await r.old("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "Claude", version: "1" },
  });
  assert.ok(init.json.result.capabilities.resources && init.json.result.capabilities.prompts);
  assert.ok(init.json.result.capabilities.tools);
  const rec = await r.old("resources/read", { uri: "vyre://record/company/rec_harbor" });
  assert.equal(rec.json.result.resultType, undefined);
  assert.equal(rec.json.result.ttlMs, undefined);
  assert.equal(JSON.parse(rec.json.result.contents[0].text).record.id, "rec_harbor");
  assert.equal((await r.old("prompts/list")).json.result.prompts.length, 2);
  assert.equal(
    (await r.old("resources/templates/list")).json.result.resourceTemplates.length,
    RESOURCE_TEMPLATES.length,
  );
});

test("a CLI engine the host runs is offered tools only: it has the Space's things and skills through its own tools", async () => {
  const r = rig(driver);
  const d = await r.ask("server/discover");
  assert.deepEqual(Object.keys(d.json.result.capabilities), ["tools"]);
  for (const method of ["resources/list", "resources/templates/list", "prompts/list", "completion/complete"]) {
    const out = await r.ask(method);
    assert.equal(out.status, 404, method);
    assert.equal(out.json.error.code, -32601, method);
  }
  const read = await r.ask("resources/read", { uri: "vyre://record/company/rec_harbor" });
  assert.equal(read.json.error.code, -32601);
  assert.equal(r.seen.length, 0);
});
