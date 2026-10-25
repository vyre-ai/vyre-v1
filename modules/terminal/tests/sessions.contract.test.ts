// The contract of the terminal module against its real handlers (ARCH 12.4): the handler table covers exactly the frozen capabilities, example inputs are accepted and answers match their output
// schemas, every error a handler raises is declared by its capability, and every event it emits is declared and matches the frozen event schema.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { handlers } from "../impl.ts";
import { bindHost, bindTeam, bindValues } from "../projections.ts";
import { assertEventsConform, codeOf, contractErrors, fakeHost, fakeValues, harness, reset } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const mine = registry.capabilities.filter((c) => c.module === "terminal");
const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any> | any>;
const NO_RULES = { allow: [], ask: [], deny: [], folders: [] };

test("the handler table covers exactly the capabilities of the terminal manifest", () => {
  assert.equal(mine.length, 16);
  assert.deepEqual(Object.keys(h).sort(), mine.map((c) => c.name).sort());
});

test("the capabilities that need no session answer their own example inputs with answers that match the output schema", async () => {
  for (const name of ["terminal.list", "terminal.status", "terminal.rules.get", "terminal.health"]) {
    const cap = mine.find((c) => c.name === name)!;
    reset();
    const hn = harness();
    bindHost(fakeHost().host);
    for (const ex of cap.examples) {
      assert.deepEqual(contractErrors(name, "in", ex.input), [], `${name}: example input`);
      assert.deepEqual(contractErrors(name, "out", await h[name]!(hn.ctx, ex.input)), [], `${name}: answer to example ${ex.name}`);
    }
  }
});

interface Scenario { cap: string; run: (hn: Harness, id: () => Promise<string>) => Promise<unknown> | unknown; expect?: string; others?: string[] }

const scenarios: Scenario[] = [
  { cap: "terminal.open", run: (hn) => h["terminal.open"]!(hn.ctx, { host: "agent_computer", agentId: "agt_a" }) },
  { cap: "terminal.open", run: (hn) => h["terminal.open"]!(hn.ctx, { host: "device" }), expect: "validation.bad_input" },
  { cap: "terminal.open", run: () => { bindTeam(() => false); return h["terminal.open"]!(harness().ctx, { host: "agent_computer", agentId: "agt_a" }); }, expect: "permission.needs_team" },
  { cap: "terminal.open", run: (hn) => { bindHost(null); return h["terminal.open"]!(hn.ctx, { host: "device", deviceId: "dev_x" }); }, expect: "provider.unavailable" },
  { cap: "terminal.open_server", run: (hn) => h["terminal.open_server"]!(hn.ctx, {}) },
  { cap: "terminal.get", run: async (hn, id) => h["terminal.get"]!(hn.ctx, { terminalId: await id() }) },
  { cap: "terminal.get", run: (hn) => h["terminal.get"]!(hn.ctx, { terminalId: "trm_none" }), expect: "validation.not_found" },
  { cap: "terminal.rename", run: async (hn, id) => h["terminal.rename"]!(hn.ctx, { terminalId: await id(), name: "x" }) },
  { cap: "terminal.rename", run: async (hn, id) => h["terminal.rename"]!(hn.ctx, { terminalId: await id(), name: " " }), expect: "validation.bad_input" },
  { cap: "terminal.input", run: async (hn, id) => h["terminal.input"]!(hn.ctx, { terminalId: await id(), data: "ls\r" }) },
  { cap: "terminal.input", run: (hn) => h["terminal.input"]!(hn.ctx, { terminalId: "trm_none", data: "x" }), expect: "validation.not_found" },
  { cap: "terminal.input", run: async (hn, id) => { const t = await id(); bindHost({ ...fakeHost().host, input: async () => { throw new Error("down"); } }); return h["terminal.input"]!(hn.ctx, { terminalId: t, data: "x" }); }, expect: "internal.unexpected" },
  { cap: "terminal.interrupt", run: async (hn, id) => h["terminal.interrupt"]!(hn.ctx, { terminalId: await id() }) },
  { cap: "terminal.resize", run: async (hn, id) => h["terminal.resize"]!(hn.ctx, { terminalId: await id(), cols: 90, rows: 20 }) },
  { cap: "terminal.read", run: async (hn, id) => h["terminal.read"]!(hn.ctx, { terminalId: await id() }) },
  { cap: "terminal.attach", run: async (hn, id) => h["terminal.attach"]!(hn.ctx, { terminalId: await id() }) },
  { cap: "terminal.status", run: async (hn, id) => h["terminal.status"]!(hn.ctx, { terminalIds: [await id()] }) },
  { cap: "terminal.close", run: async (hn, id) => h["terminal.close"]!(hn.ctx, { terminalId: await id() }) },
  { cap: "terminal.close", run: (hn) => h["terminal.close"]!(hn.ctx, { terminalId: "trm_none" }), expect: "validation.not_found" },
  { cap: "terminal.list", run: async (hn, id) => { await id(); return h["terminal.list"]!(hn.ctx, {}); } },
  { cap: "terminal.run", run: async (hn, id) => h["terminal.run"]!(hn.ctx, { command: "ls", terminalId: await id() }), others: ["terminal.opened"] },
  { cap: "terminal.run", run: (hn) => h["terminal.run"]!(hn.as({ kind: "agent", id: "agt_a" }, "usr_dana"), { command: "ls" }) },
  { cap: "terminal.run", run: async (hn, id) => h["terminal.run"]!(hn.ctx, { command: "boom", terminalId: await id() }), expect: "provider.unavailable" },
  { cap: "terminal.run", run: async (hn, id) => { const t = await id(); await h["terminal.rules.set"]!(hn.ctx, { rules: { ...NO_RULES, deny: ["ls"] } }); return h["terminal.run"]!(hn.ctx, { command: "ls", terminalId: t }); }, expect: "permission.role_lacks_permission", others: ["terminal.rules_changed"] },
  { cap: "terminal.run", run: async (hn, id) => { bindValues(fakeValues({}, new Set(["#A_B.c"]))); return h["terminal.run"]!(hn.ctx, { command: "x #A_B.c", terminalId: await id() }); }, expect: "permission.no_grant" },
  { cap: "terminal.run", run: async (hn, id) => h["terminal.run"]!(hn.ctx, { command: "", terminalId: await id() }), expect: "validation.bad_input" },
  { cap: "terminal.run", run: (hn) => h["terminal.run"]!(hn.ctx, { command: "ls", terminalId: "trm_none" }), expect: "validation.not_found" },
  { cap: "terminal.rules.get", run: (hn) => h["terminal.rules.get"]!(hn.ctx, {}) },
  { cap: "terminal.rules.set", run: (hn) => h["terminal.rules.set"]!(hn.ctx, { rules: { ...NO_RULES, allow: ["ls"] } }) },
  { cap: "terminal.rules.set", run: (hn) => h["terminal.rules.set"]!(hn.ctx, { rules: { ...NO_RULES, allow: ["x".repeat(201)] } }), expect: "validation.bad_input" },
  { cap: "terminal.health", run: (hn) => h["terminal.health"]!(hn.ctx, {}) },
];

test("every path through every capability: answers match the schema, errors are declared, events are declared and match their schemas", async () => {
  let happy = 0, unhappy = 0;
  for (const s of scenarios) {
    reset();
    const hn = harness();
    const fake = fakeHost({ ls: { exitCode: 0, output: "a" }, boom: { exitCode: 0, output: "" } });
    bindHost(fake.host);
    if (s.expect === "provider.unavailable" && s.cap === "terminal.run") fake.failRunWith(new Error("tmux: server exited"));
    const cap = mine.find((c) => c.name === s.cap)!;
    const idOf = async (): Promise<string> => (await h["terminal.open"]!(hn.ctx, { host: "agent_computer", agentId: "agt_a" })).terminal.terminalId as string;
    let out: unknown;
    let code: string | null = null;
    try { out = await s.run(hn, idOf); } catch (e) { code = codeOf(e); }
    if (s.expect !== undefined) {
      unhappy++;
      assert.equal(code, s.expect, `${s.cap}: expected ${s.expect}`);
      assert.ok((cap.errors as readonly string[]).includes(s.expect), `${s.cap} does not declare ${s.expect}`);
    } else {
      happy++;
      assert.equal(code, null, `${s.cap} raised ${String(code)}`);
      assert.deepEqual(contractErrors(s.cap, "out", out), [], `${s.cap}: answer`);
    }
    const allowed = new Set([...(cap.emits as readonly string[]), "terminal.opened", ...(s.others ?? [])]);
    for (const e of hn.emitted) assert.ok(allowed.has(e.name), `${s.cap} emitted undeclared ${e.name}`);
    assert.deepEqual(assertEventsConform(hn), [], s.cap);
  }
  reset();
  assert.ok(happy >= 17 && unhappy >= 14, `${happy} happy, ${unhappy} unhappy`);
});

test("each capability that changes something raises its declared event, and the reads raise none", async () => {
  reset();
  const hn = harness();
  bindHost(fakeHost({ ls: { exitCode: 0, output: "a" } }).host);
  const t = (await h["terminal.open"]!(hn.ctx, { host: "agent_computer", agentId: "agt_a" })).terminal.terminalId as string;
  await h["terminal.rename"]!(hn.ctx, { terminalId: t, name: "build" });
  await h["terminal.run"]!(hn.ctx, { command: "ls", terminalId: t });
  await h["terminal.rules.set"]!(hn.ctx, { rules: { ...NO_RULES, allow: ["ls"] } });
  await h["terminal.close"]!(hn.ctx, { terminalId: t });
  assert.deepEqual(hn.emitted.map((e) => e.name), ["terminal.opened", "terminal.renamed", "terminal.command_finished", "terminal.rules_changed", "terminal.closed"]);
  const before = hn.emitted.length;
  bindHost(fakeHost().host);
  for (const [cap, input] of [["terminal.list", {}], ["terminal.get", { terminalId: t }], ["terminal.status", { terminalIds: [t] }], ["terminal.rules.get", {}], ["terminal.health", {}]] as const) await h[cap]!(hn.ctx, input);
  assert.equal(hn.emitted.length, before);
  reset();
});
