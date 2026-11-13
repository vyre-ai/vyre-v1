// An unexpected error leaves its message and stack on the server (13 Nov 2026: the owner's agent got internal.unexpected on a first browser call and the server held no message and no stack anywhere).
// The caller still sees only "Something went wrong on our side"; the server writes the underlying message and stack with the trace id, with known secrets and key-shaped tokens taken out.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize } from "../../kernel/src/authorize/index.ts";
import { createInvoke, indexCapabilities, resetUnexpectedLog, unexpectedWords } from "../src/invoke.ts";
import type { CtxSeed, InvokeDeps } from "../src/invoke.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";

const cap = { v: 1, name: "example.boom", summary: "s", input: { type: "object" }, output: { type: "object" }, errors: [], resource: { type: "space" }, permission: null, level: "view", risk: "low", effects: "read", emits: [], idempotency: "natural", surfaces: {}, examples: [] } as unknown as CapabilityDef;

async function boom(thrown: unknown) {
  const s = new AccessSnapshot();
  s.putPrincipal({ id: "usr_dana", kind: "person", status: "active", name: "Dana" });
  s.putResource({ id: "spc_1", type: "space", parent_id: null, label: 0, owner_id: "usr_dana", holds: 0 });
  const seen: Array<{ cap: string; traceId: string; message: string; stack: string }> = [];
  const rows: Array<{ msg: string; attrs?: Record<string, unknown> }> = [];
  const deps: InvokeDeps = {
    caps: indexCapabilities([cap]), validateInput: () => [], authorize: (r) => authorize(s, r),
    handler: () => async () => { throw thrown; },
    commit: async (b) => b.events.map((e, i) => ({ ...e, seq: i + 1 })), publish: () => {}, now: () => 1_000,
    secrets: () => ["plain-secret-value"], onUnexpected: (a) => seen.push(a),
    log: { debug() {}, info() {}, warn() {}, error: (msg, attrs) => rows.push({ msg, ...(attrs ? { attrs } : {}) }) },
  };
  const seed: CtxSeed = { space: "spc_1", principal: { kind: "person", id: "usr_dana" } };
  const err = await createInvoke(deps)("example.boom", {}, seed).then(() => null, (e: { error?: { code: string; message: string; traceId: string } }) => e);
  return { err, seen, rows };
}

test("an unexpected error keeps its message and stack on the server, with the trace id, and the caller sees none of it", async () => {
  const { err, seen, rows } = await boom(new TypeError("cannot read x of undefined while using plain-secret-value"));
  assert.equal(err?.error?.code, "internal.unexpected");
  assert.equal(err?.error?.message, "Something went wrong on our side.");
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.traceId, err?.error?.traceId, "the trace id the caller was given");
  assert.match(seen[0]!.message, /TypeError: cannot read x of undefined/);
  assert.match(seen[0]!.stack, /invoke\.unexpected-log\.test\.ts/, "the stack is there");
  assert.ok(!seen[0]!.message.includes("plain-secret-value") && !seen[0]!.stack.includes("plain-secret-value"), "a known secret is taken out");
  const row = rows.find((r) => r.msg === "handler threw");
  assert.ok(row && typeof row.attrs?.["stack"] === "string" && row.attrs["message"] === undefined, "the log row carries frames and no message");
  assert.ok(!String(row.attrs["stack"]).includes("cannot read x"), "and its stack holds no copy of the message");
  assert.ok(String(row.attrs["stack"]).split("\n").length <= 4, "four frames at most");
});

test("a thrown value that is not an Error is kept too, and key-shaped tokens and bearer values are taken out", () => {
  const w = unexpectedWords("failed with Bearer abcdefghijklmnop1234 and rk_abcdefghijklmnopqrstu", []);
  assert.equal(w.message, "failed with [hidden] and [hidden]");
  assert.equal(unexpectedWords(undefined, []).message, "undefined");
});

test("a thrown value that cannot be read never makes the logging throw, and the original error still reaches the caller", async () => {
  const hostile = new Proxy({}, { get() { throw new Error("no"); }, getPrototypeOf() { throw new Error("no"); } });
  const w = unexpectedWords(hostile, []);
  assert.equal(typeof w.message, "string");
  const { err } = await boom(Object.defineProperty(new Error("fine"), "stack", { get(): string { throw new Error("stack getter"); } }));
  assert.equal(err?.error?.code, "internal.unexpected");
});

test("with no hook the line goes to the server's own output", async () => {
  resetUnexpectedLog();
  const lines: string[] = [];
  const was = process.stderr.write;
  process.stderr.write = ((c: string) => { lines.push(String(c)); return true; }) as typeof process.stderr.write;
  try {
    const s = new AccessSnapshot();
    s.putPrincipal({ id: "usr_dana", kind: "person", status: "active", name: "Dana" });
    s.putResource({ id: "spc_1", type: "space", parent_id: null, label: 0, owner_id: "usr_dana", holds: 0 });
    const deps: InvokeDeps = { caps: indexCapabilities([cap]), validateInput: () => [], authorize: (r) => authorize(s, r), handler: () => async () => { throw new Error("no hook"); }, commit: async (b) => b.events.map((e, i) => ({ ...e, seq: i + 1 })), publish: () => {}, now: () => 1_000 };
    await createInvoke(deps)("example.boom", {}, { space: "spc_1", principal: { kind: "person", id: "usr_dana" } }).catch(() => undefined);
  } finally { process.stderr.write = was; }
  assert.ok(lines.some((l) => l.startsWith("vyred: handler threw ") && l.includes("Error: no hook")), lines.join("|"));
});

test("the same capability and message is written once a minute, then counted", async () => {
  resetUnexpectedLog();
  const lines: string[] = [];
  const was = process.stderr.write;
  process.stderr.write = ((c: string) => { lines.push(String(c)); return true; }) as typeof process.stderr.write;
  const seed: CtxSeed = { space: "spc_1", principal: { kind: "person", id: "usr_dana" } };
  try {
    const s = new AccessSnapshot();
    s.putPrincipal({ id: "usr_dana", kind: "person", status: "active", name: "Dana" });
    s.putResource({ id: "spc_1", type: "space", parent_id: null, label: 0, owner_id: "usr_dana", holds: 0 });
    let t = 1_000_000;
    const deps: InvokeDeps = { caps: indexCapabilities([cap]), validateInput: () => [], authorize: (r) => authorize(s, r), handler: () => async () => { throw new Error("poll failed"); }, commit: async (b) => b.events.map((e, i) => ({ ...e, seq: i + 1 })), publish: () => {}, now: () => t };
    const run = createInvoke(deps);
    for (let i = 0; i < 30; i++) await run("example.boom", {}, seed).catch(() => undefined);
    assert.equal(lines.length, 1, "30 identical failures are one line");
    // the minute passes (the limiter reads the wall clock): fake it by writing past it
    const real = Date.now;
    Date.now = () => real() + 61_000;
    try { await run("example.boom", {}, seed).catch(() => undefined); } finally { Date.now = real; }
    assert.equal(lines.length, 2);
    assert.match(lines[1]!, /"repeated":29/, "the next line carries the count");
  } finally { process.stderr.write = was; }
});
