// A call refused for its input leaves WHICH inputs were wrong and the rule each broke in the server's log row (13 Nov 2026: the row held only the capability and the status, so nobody could tell from a live
// Space why an agent's first call failed). Names and rules only: never a value, never a secret. A call made by a tool also says which tool it was and whether it was the first call to that tool in the turn.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize } from "../../kernel/src/authorize/index.ts";
import { createInvoke, indexCapabilities, rejectedFields } from "../src/invoke.ts";
import type { CtxSeed, InvokeDeps } from "../src/invoke.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";

const cap = {
  v: 1,
  name: "example.make",
  summary: "s",
  input: {
    type: "object",
    properties: {
      title: { type: "string" },
      port: { type: "integer" },
      html: { type: "string" },
      note: { type: "string" },
      items: { type: "array", items: { type: "object", properties: { id: { type: "string" } } } },
    },
  },
  output: { type: "object" },
  errors: [],
  resource: { type: "space" },
  permission: null,
  level: "view",
  risk: "low",
  effects: "write",
  emits: [],
  idempotency: "natural",
  surfaces: {},
  examples: [],
} as unknown as CapabilityDef;

async function reject(problems: string[], seed: Partial<CtxSeed> = {}, input: unknown = {}) {
  const s = new AccessSnapshot();
  s.putPrincipal({ id: "usr_dana", kind: "person", status: "active", name: "Dana" });
  s.putResource({ id: "spc_1", type: "space", parent_id: null, label: 0, owner_id: "usr_dana", holds: 0 });
  const rows: Array<{ msg: string; attrs?: Record<string, unknown> }> = [];
  const deps: InvokeDeps = {
    caps: indexCapabilities([cap]),
    validateInput: () => problems,
    authorize: (r) => authorize(s, r),
    handler: () => async () => ({}),
    commit: async (b) => b.events.map((e, i) => ({ ...e, seq: i + 1 })),
    publish: () => {},
    now: () => 1_000,
    log: {
      debug() {},
      warn() {},
      error() {},
      info: (msg, attrs) => rows.push({ msg, ...(attrs ? { attrs } : {}) }),
    },
  };
  const base: CtxSeed = { space: "spc_1", principal: { kind: "person", id: "usr_dana" }, ...seed };
  const err = await createInvoke(deps)("example.make", input, base).then(
    () => null,
    (e: { error?: { code: string; details?: Record<string, unknown> } }) => e,
  );
  return { err, rows };
}

test("a call refused for its input logs each wrong input by path and rule", async () => {
  const { err, rows } = await reject(["/title: required", "/port: above maximum", "/items/2/id: pattern"]);
  assert.equal(err?.error?.code, "validation.bad_input");
  const row = rows.find((r) => r.msg === "invoke");
  assert.ok(row, "the invoke row");
  assert.deepEqual(row.attrs?.["fields"], [
    { path: "/title", rule: "required" },
    { path: "/port", rule: "above maximum" },
    { path: "/items/2/id", rule: "pattern" },
  ]);
});

test("a value never reaches the log: the row holds the input's names and rules, not what the caller wrote", async () => {
  const secret = "hunter2-SECRET-VALUE";
  const { rows } = await reject(
    ["/html: expected string got number", `/note: the value ${secret} is bad`, `/${secret}: required`],
    {},
    { html: secret, note: secret, token: secret },
  );
  const all = JSON.stringify(rows);
  assert.ok(!all.includes(secret), "no value, and no problem text that carries one, is written");
  const fields = rows.find((r) => r.msg === "invoke")?.attrs?.["fields"] as Array<{ path: string; rule: string }>;
  assert.deepEqual(fields, [
    { path: "/html", rule: "expected string got number" },
    { path: "/*", rule: "required" },
  ]);
});

test("the row says which tool made the call and whether it was the first call to that tool in the turn", async () => {
  const first = await reject(["/title: required"], { callMeta: { tool: "artifact_publish", first: true } });
  const attrs = first.rows.find((r) => r.msg === "invoke")?.attrs;
  assert.equal(attrs?.["tool"], "artifact_publish");
  assert.equal(attrs?.["first"], true);
  const again = await reject(["/title: required"], { callMeta: { tool: "artifact_publish", first: false } });
  assert.equal(again.rows.find((r) => r.msg === "invoke")?.attrs?.["first"], false);
});

test("a call that is not a tool's carries no tool name, and a refusal that is not about input carries no fields", async () => {
  const { rows } = await reject(["/title: required"]);
  const attrs = rows.find((r) => r.msg === "invoke")?.attrs;
  assert.equal(attrs?.["tool"], undefined);
  assert.equal(rejectedFields([]).length, 0);
});

test("rejectedFields keeps at most twenty and drops a path or rule that is not a plain name", () => {
  const many = Array.from({ length: 30 }, (_, i) => `/f${i}: required`);
  assert.equal(rejectedFields(many).length, 20);
  assert.deepEqual(
    rejectedFields(["/a b: required", '/ok: has "quotes" and a value', "/ok: the value is bad", "/ok: not in enum"]),
    [{ path: "/ok", rule: "not in enum" }],
  );
});

test("a retry that works after a refusal for input leaves a row of its own naming the tool", async () => {
  const rows: Array<{ msg: string; attrs?: Record<string, unknown> }> = [];
  const s = new AccessSnapshot();
  s.putPrincipal({ id: "usr_dana", kind: "person", status: "active", name: "Dana" });
  s.putResource({ id: "spc_1", type: "space", parent_id: null, label: 0, owner_id: "usr_dana", holds: 0 });
  const deps: InvokeDeps = {
    caps: indexCapabilities([cap]),
    validateInput: () => [],
    authorize: (r) => authorize(s, r),
    handler: () => async () => ({}),
    commit: async (b) => b.events.map((e, i) => ({ ...e, seq: i + 1 })),
    publish: () => {},
    now: () => 1_000,
    log: { debug() {}, warn() {}, error() {}, info: (msg, attrs) => rows.push({ msg, ...(attrs ? { attrs } : {}) }) },
  };
  const seed: CtxSeed = {
    space: "spc_1",
    principal: { kind: "person", id: "usr_dana" },
    callMeta: { tool: "artifact_publish", first: false, afterReject: true },
  };
  await createInvoke(deps)("example.make", {}, seed);
  const row = rows.find((r) => r.msg === "invoke.retry_ok");
  assert.equal(row?.attrs?.["tool"], "artifact_publish");
  assert.equal(row?.attrs?.["first"], false);
});

test("a refused call's row says which chat and which run it came from, so a repeated refusal can be traced", async () => {
  const { rows } = await reject(["/title: required"], { thread: "thr_1", run: "run_9" });
  const a = rows.find((r) => r.msg === "invoke")?.attrs;
  assert.equal(a?.["threadId"], "thr_1");
  assert.equal(a?.["runId"], "run_9");
});
