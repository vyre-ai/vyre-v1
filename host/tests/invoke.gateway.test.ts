// The gateway over the invoke pipeline, and the pipeline against the real generated registry, route table and validators.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize } from "../../kernel/src/authorize/index.ts";
import { createIdempotency } from "../../kernel/src/idempotency/index.ts";
import { createGateway, indexRoutes, parseTrace } from "../src/gateway.ts";
import type { GatewayDeps } from "../src/gateway.ts";
import { createInvoke, indexCapabilities } from "../src/invoke.ts";
import type { GateHook, Handler, InvokeDeps } from "../src/invoke.ts";
import { registry } from "../../generated/registry.ts";
import { routes } from "../../generated/routes.ts";
import { validateInput, validateOutput } from "../../generated/validators.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";

const caps = registry.capabilities as unknown as CapabilityDef[];

function snapshotFor(perms: string[]) {
  const s = new AccessSnapshot();
  s.putRole({ id: "member", clearance: 3, perms, name: "Member" });
  s.putPrincipal({ id: "usr_dana", kind: "person", status: "active", name: "Dana" });
  s.addPrincipalRole({ holder: "usr_dana", role: "member" });
  s.putResource({ id: "spc_1", type: "space", parent_id: null, label: 0, owner_id: "usr_dana", holds: 0 });
  return s;
}

function stack(handlers: Record<string, Handler>, snap: AccessSnapshot, o: { gate?: GateHook; capsOverride?: CapabilityDef[] } = {}) {
  const store = new Map<string, { hash: string; result: unknown }>();
  const idem = createIdempotency({ get: (k) => store.get(k) ?? null, put: (k, _p, _c, rec) => { store.set(k, rec as { hash: string; result: unknown }); } });
  const index = indexCapabilities(o.capsOverride ?? caps);
  const deps: InvokeDeps = {
    caps: index, validateInput, authorize: (r) => authorize(snap, r), handler: (c) => handlers[c],
    commit: async (b) => b.events.map((e, i) => ({ ...e, seq: i + 1 })), idem, ...(o.gate ? { gate: o.gate } : {}),
  };
  const invoke = createInvoke(deps);
  const gdeps: GatewayDeps = {
    invoke, caps: index, routes,
    session: (h) => (h["authorization"] === "Bearer dana" ? { space: "spc_1", principal: { kind: "person", id: "usr_dana" } } : null),
    preAuth: (caller, h) => (h["x-anon"] ? { space: "spc_1", principal: { kind: "actor", id: `${caller}_caller` } } : null),
  };
  return { handle: createGateway(gdeps), invoke };
}

test("the generated route table indexes without duplicates and covers every capability once", () => {
  const find = indexRoutes(routes);
  assert.equal(routes.length, caps.length);
  for (const r of routes.slice(0, 200)) assert.equal(find(r.method, r.path)?.cap, r.cap);
  assert.equal(find("get", "/book/availability/")?.cap, "bookings.availability", "case of method and a trailing slash do not matter");
  assert.equal(find("GET", "/nope"), undefined);
});

test("parseTrace reads x-vyre-trace", () => {
  assert.deepEqual(parseTrace(`${"a".repeat(32)}-${"b".repeat(16)}`), { traceId: "a".repeat(32), spanId: "b".repeat(16) });
  assert.deepEqual(parseTrace(`${"a".repeat(32)}-${"b".repeat(16)}-${"c".repeat(16)}`), { traceId: "a".repeat(32), spanId: "b".repeat(16) });
  assert.equal(parseTrace("garbage"), undefined);
  assert.equal(parseTrace(undefined), undefined);
});

// pick a real capability bound to the Space that needs a key, has an example, no Gate and a permission
const real = caps.find((c) => c.resource.type === "space" && c.idempotency === "key" && !c.gate && c.permission && c.examples.length && !c.caller && c.surfaces.http !== undefined)!;
const route = routes.find((r) => r.cap === real.name)!;

test(`real registry: ${real.name} runs through the gateway with its example input, replays on the same key, and its output validates`, async () => {
  const out = real.examples[0]!.output;
  let runs = 0;
  const s = stack({ [real.name]: () => { runs++; return out; } }, snapshotFor([real.permission!]));
  const headers = { authorization: "Bearer dana" };
  const input = real.examples[0]!.input;
  const r1 = await s.handle({ method: route.method, path: route.path, headers, body: input, query: route.method === "GET" ? (input as Record<string, string>) : undefined });
  assert.equal(r1.status, 200, JSON.stringify(r1.body).slice(0, 300));
  assert.deepEqual("data" in r1.body ? r1.body.data : null, out);
  assert.match(r1.headers["x-vyre-trace"]!, /^[0-9a-f]{32}$/);
  assert.deepEqual(validateOutput(real.name, real.v, out), [], "the example output satisfies the compiled output validator");
  const r2 = await s.handle({ method: route.method, path: route.path, headers, body: input });
  assert.equal(r2.status, 200); assert.equal(runs, 1, "same key, same input: the handler ran once");
});

test("real registry: a caller without the role permission gets 403 permission.role_lacks_permission", async () => {
  const s = stack({ [real.name]: () => ({}) }, snapshotFor(["something.else"]));
  const r = await s.handle({ method: route.method, path: route.path, headers: { authorization: "Bearer dana" }, body: real.examples[0]!.input });
  assert.equal(r.status, 403);
  assert.equal("error" in r.body && r.body.error.code, "permission.role_lacks_permission");
});

test("gateway errors: unknown route 404, no session 401, bad input 422, with { error } bodies and the trace header", async () => {
  const s = stack({ [real.name]: () => ({}) }, snapshotFor([real.permission!]));
  const miss = await s.handle({ method: "POST", path: "/nothing/here", headers: { authorization: "Bearer dana" } });
  assert.equal(miss.status, 404); assert.equal("error" in miss.body && miss.body.error.code, "validation.unknown_capability");
  const anon = await s.handle({ method: route.method, path: route.path, headers: {}, body: {} });
  assert.equal(anon.status, 401); assert.equal("error" in anon.body && anon.body.error.code, "auth.unauthenticated");
  const trace = { "x-vyre-trace": `${"a".repeat(32)}-${"b".repeat(16)}` };
  const bad = await s.handle({ method: route.method, path: route.path, headers: { authorization: "Bearer dana", ...trace }, body: { wrong: true } });
  assert.equal(bad.status, 422); assert.equal("error" in bad.body && bad.body.error.code, "validation.bad_input");
  assert.equal(bad.headers["x-vyre-trace"], "a".repeat(32), "the caller's trace id is kept");
  assert.ok("error" in bad.body && Array.isArray((bad.body.error.details as { errors: string[] }).errors));
});

test("Idempotency-Key header fills the key; GET reads the query; held answers 202", async () => {
  const synthetic: CapabilityDef[] = [
    { name: "demo.write", v: 1, permission: "demo.edit", level: "edit", resource: { type: "space" }, idempotency: "key", effects: "write", risk: "low", emits: [], examples: [], surfaces: {}, input: {}, output: {}, errors: [], summary: "" },
    { name: "demo.read", v: 1, permission: "demo.edit", level: "view", resource: { type: "space" }, idempotency: "natural", effects: "read", risk: "low", emits: [], examples: [], surfaces: {}, input: {}, output: {}, errors: [], summary: "" },
    { name: "demo.send", v: 1, permission: "demo.edit", level: "edit", resource: { type: "space" }, idempotency: "natural", effects: "outward", risk: "high", emits: [], examples: [], surfaces: {}, input: {}, output: {}, errors: [], gate: { act: "send" }, summary: "" },
  ] as unknown as CapabilityDef[];
  const rt = [
    { method: "POST", path: "/demo/write", cap: "demo.write", v: 1, effects: "write" }, { method: "GET", path: "/demo/read", cap: "demo.read", v: 1, effects: "read" },
    { method: "POST", path: "/demo/send", cap: "demo.send", v: 1, effects: "outward" },
  ] as const;
  const snap = snapshotFor(["demo.edit"]);
  const seen: unknown[] = [];
  const store = new Map<string, { hash: string; result: unknown }>();
  const idem = createIdempotency({ get: (k) => store.get(k) ?? null, put: (k, _p, _c, rec) => { store.set(k, rec as { hash: string; result: unknown }); } });
  const index = indexCapabilities(synthetic);
  const gate: GateHook = { applies: () => ({ act: "send" }), park: async () => ({ taskId: "tsk_7", runId: "run_7" }), verify: () => false };
  const invoke = createInvoke({
    caps: index, validateInput: (_c, _v, i) => (i && typeof i === "object" ? [] : ["/: expected object"]), authorize: (r) => authorize(snap, r),
    handler: (c) => (c === "demo.write" || c === "demo.read" || c === "demo.send" ? (_ctx, i) => { seen.push(i); return { echoed: i }; } : undefined), commit: async (b) => b.events as never, idem, gate,
  });
  const handle = createGateway({ invoke, caps: index, routes: rt, session: () => ({ space: "spc_1", principal: { kind: "person", id: "usr_dana" } }) });
  const w = await handle({ method: "POST", path: "/demo/write", headers: { "idempotency-key": "hdr-1" }, body: { a: 1 } });
  assert.equal(w.status, 200); assert.deepEqual(seen[0], { a: 1, idempotencyKey: "hdr-1" });
  const g = await handle({ method: "GET", path: "/demo/read", headers: {}, query: { q: "x" } });
  assert.deepEqual("data" in g.body && g.body.data, { echoed: { q: "x" } });
  const h = await handle({ method: "POST", path: "/demo/send", headers: {}, body: {} });
  assert.equal(h.status, 202); assert.deepEqual("data" in h.body && h.body.data, { status: "held", taskId: "tsk_7", runId: "run_7" });
});

test("callers before sign-in use preAuth and skip authorize; without it they are refused", async () => {
  const anonCap = caps.find((c) => c.caller === "anonymous" && c.examples.length && c.idempotency !== "key")!;
  assert.ok(anonCap, "the registry has an anonymous caller capability");
  const rt = routes.find((r) => r.cap === anonCap.name)!;
  const s = stack({ [anonCap.name]: () => ({ ok: true }) }, snapshotFor([]));
  const refused = await s.handle({ method: rt.method, path: rt.path, headers: {}, body: anonCap.examples[0]!.input, query: anonCap.examples[0]!.input as Record<string, string> });
  assert.equal(refused.status, 401);
  const ok = await s.handle({ method: rt.method, path: rt.path, headers: { "x-anon": "1" }, body: anonCap.examples[0]!.input, query: anonCap.examples[0]!.input as Record<string, string> });
  assert.equal(ok.status, 200, JSON.stringify(ok.body).slice(0, 300));
});
