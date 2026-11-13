// An unexpected error leaves its message and stack on the server (13 Nov 2026: the owner's agent got internal.unexpected on a first browser call and the server held no message and no stack anywhere).
// The caller still sees only "Something went wrong on our side"; the server writes the underlying message and stack with the trace id, with known secrets and key-shaped tokens taken out.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize } from "../../kernel/src/authorize/index.ts";
import { createInvoke, indexCapabilities, unexpectedWords } from "../src/invoke.ts";
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
  assert.ok(row && typeof row.attrs?.["message"] === "string" && typeof row.attrs?.["stack"] === "string", "the log row carries both");
});

test("a thrown value that is not an Error is kept too, and key-shaped tokens and bearer values are taken out", () => {
  const w = unexpectedWords("failed with Bearer abcdefghijklmnop1234 and rk_abcdefghijklmnopqrstu", []);
  assert.equal(w.message, "failed with Bearer [REDACTED] and [REDACTED]");
  assert.equal(unexpectedWords(undefined, []).message, "undefined");
});

test("with no hook the line goes to the server's own output", async () => {
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
