// createTestSpace (ARCH 10.1): boots from a copied template under 80 ms, runs the real kernel and host in-process, isolates Spaces, fake clock.
import test from "node:test";
import assert from "node:assert/strict";
import { createTestSpace, createClock, SPACE_ID } from "../src/index.ts";
import { registry } from "../../generated/registry.ts";
import { validateEvent } from "../../generated/validators.ts";
import { HostError } from "../../host/src/invoke.ts";
import { readFileSync } from "node:fs";

// The test asks a capability whose module is still a stub (it checks that a stub answers its example), so capabilities of modules that have gone live are not candidates.
const live = new Set((JSON.parse(readFileSync(new URL("../../host/modules.json", import.meta.url), "utf8")) as { modules: { id: string; status: string }[] }).modules.filter((m) => m.status === "live").map((m) => m.id));
type Cap = { module: string; name: string; v: number; emits: string[]; permission: string | null; resource: { type: string }; idempotency: string; gate?: unknown; caller?: unknown; examples: { input: unknown; output: unknown }[] };
const caps = registry.capabilities as unknown as Cap[];
const perms = new Map((registry.permissions as unknown as { key: string; defaults: Record<string, boolean> }[]).map((p) => [p.key, p.defaults]));
const usable = caps.filter((c) => !live.has(c.module) && c.resource.type === "space" && c.permission && c.idempotency !== "key" && !c.gate && !c.caller && c.examples.length);
const adminOnly = usable.find((c) => perms.get(c.permission!)!["member"] === false && perms.get(c.permission!)!["admin"] === true)!;
const memberOk = usable.find((c) => perms.get(c.permission!)!["member"] === true)!;

function sample(s: any): unknown {
  if (s.const !== undefined) return s.const;
  if (s.enum) return s.enum[0];
  if (s.examples?.length) return s.examples[0];
  const t = Array.isArray(s.type) ? s.type[0] : s.type;
  if (t === "object") return Object.fromEntries((s.required ?? []).map((k: string) => [k, sample(s.properties[k])]));
  if (t === "array") return [];
  if (t === "integer" || t === "number") return s.minimum ?? 0;
  if (t === "boolean") return false;
  return "x";
}
const evDefs = registry.events as unknown as { name: string; payload: unknown }[];
const emitter = usable.find((c) => perms.get(c.permission!)!["member"] === true && c.emits.some((e) => { const d = evDefs.find((x) => x.name === e); return d && validateEvent(e, sample(d.payload)).length === 0; }))!;
const emitName = emitter.emits.find((e) => validateEvent(e, sample(evDefs.find((x) => x.name === e)!.payload)).length === 0)!;
const emitPayload = sample(evDefs.find((x) => x.name === emitName)!.payload);


test("a blank Space boots and returns api, events, clock, close (the 80 ms boot budget is in createTestSpace.perf.test.ts)", async () => {
  const warm = await createTestSpace(); await warm.close();
  for (let i = 0; i < 3; i++) {
    const s = await createTestSpace();
    assert.equal(typeof s.api, "function"); assert.equal(typeof s.close, "function");
    assert.equal(typeof s.clock.now(), "number"); assert.equal((await s.events.head()).seq, 0);
    assert.equal(await s.events.verify(), true);
    await s.close();
  }
});

test("api(asPrincipal): a stub answers its example; the role decides who may call", async () => {
  const s = await createTestSpace({ seed: "small" });
  try {
    assert.deepEqual(await s.api("usr_admin").call(adminOnly.name, adminOnly.examples[0]!.input), adminOnly.examples[0]!.output);
    await assert.rejects(s.api("usr_ana").call(adminOnly.name, adminOnly.examples[0]!.input), (e: unknown) => e instanceof HostError && e.error.code === "permission.role_lacks_permission");
    assert.deepEqual(await s.api("usr_ana").call(memberOk.name, memberOk.examples[0]!.input), memberOk.examples[0]!.output);
    await assert.rejects(s.api("usr_guest").call(memberOk.name, memberOk.examples[0]!.input), (e: unknown) => e instanceof HostError && e.error.code.startsWith("permission."));
    await assert.rejects(s.api("usr_nobody").call(memberOk.name, memberOk.examples[0]!.input), (e: unknown) => e instanceof HostError && e.error.code === "auth.unauthenticated");
  } finally { await s.close(); }
});

test("a handler's events reach the log with the call's trace id, the fake clock's time, the bus and the audit", async () => {
  const clock = createClock(1_700_000_000_000);
  const s = await createTestSpace({ clock, handlers: { [emitter.name]: (ctx) => { ctx.emit(emitName as never, "space/spc_test", emitPayload); return emitter.examples[0]!.output; } } });
  try {
    const trace = { traceId: "c".repeat(32), spanId: "d".repeat(16) };
    const r = await s.api("usr_owner").invoke(emitter.name, emitter.examples[0]!.input, { trace });
    assert.equal(r.status, "ok");
    const evs = await s.events.read();
    assert.equal(evs.length, 1); assert.equal(evs[0]!.type, emitName); assert.equal(evs[0]!.trace_id, "c".repeat(32)); assert.equal(evs[0]!.actor, "usr_owner");
    assert.equal(s.published.length, 1); assert.equal(s.published[0]!.seq, evs[0]!.seq);
    assert.ok(evs[0]!.at >= 1, "the log stamps its own wall time");
    assert.equal(await s.events.verify(), true);
    assert.equal(clock.advance(5_000), 1_700_000_005_000);
  } finally { await s.close(); }
});

test("Spaces are isolated and close removes their files", async () => {
  const a = await createTestSpace({ handlers: { [emitter.name]: (ctx) => { ctx.emit(emitName as never, "space/spc_test", emitPayload); return emitter.examples[0]!.output; } } });
  const b = await createTestSpace();
  try {
    await a.api("usr_owner").call(emitter.name, emitter.examples[0]!.input);
    assert.equal((await a.events.read()).length, 1); assert.equal((await b.events.read()).length, 0);
    assert.equal((await b.events.head()).seq, 0);
  } finally { await a.close(); await b.close(); }
});

test("fake clock moves only forward; an unavailable seed is refused", async () => {
  const c = createClock(10); c.advance(5); assert.equal(c.now(), 15);
  assert.throws(() => c.advance(-1), RangeError);
  await assert.rejects(createTestSpace({ seed: "perf" as never }), /not available yet/);
  assert.equal(SPACE_ID, "spc_test");
});

test("roles option replaces the seed's people", async () => {
  const s = await createTestSpace({ roles: { usr_a: "owner", usr_b: "guest" } });
  try {
    assert.deepEqual(await s.api("usr_a").call(adminOnly.name, adminOnly.examples[0]!.input), adminOnly.examples[0]!.output);
    await assert.rejects(s.api("usr_b").call(adminOnly.name, adminOnly.examples[0]!.input));
  } finally { await s.close(); }
});
