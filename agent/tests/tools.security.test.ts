// Gate and local-tool modes (spec 2.14, 4.17): Ask, Allow and Auto govern only local tool prompts. They cannot loosen the Gate.
import test from "node:test";
import assert from "node:assert/strict";
import { decideLocal, effectiveMode } from "../src/tools/index.ts";
import type { LocalFacts, SecurityMode, ToolDef } from "../src/tools/index.ts";
import { ctx, loadGenerated, makeSession } from "../src/tools/harness.ts";

const MODES: SecurityMode[] = ["ask", "allow", "auto"];

test("Auto cannot loosen the Gate: every outward tool is a single invoke as the agent for the asker, and gated ones are held, in every mode", async () => {
  const loaded = loadGenerated();
  const outward = loaded.catalog.all.filter((t) => t.effects === "outward" && t.local === "none");
  assert.ok(outward.length >= 70, `${outward.length} outward tools`);
  let held = 0;
  for (const mode of MODES) {
    const { session, calls } = makeSession({ engineer: true, localPolicy: (t) => decideLocal(t, mode, "auto") });
    const c = ctx();
    for (const t of outward) {
      if (!loaded.defaults.has(t.name)) session.search(c, t.name);
      const before = calls.length;
      const out = await session.call(c, t.name, {});
      assert.equal(calls.length, before + 1, `${t.name} in ${mode}: exactly one invoke`);
      const row = calls.at(-1);
      assert.ok(row);
      assert.equal(row.cap, t.cap);
      assert.equal(row.principal, "agt_intake");
      assert.equal(row.actingFor, "per_dana");
      assert.equal(row.approval, undefined, `${t.name} in ${mode}: no approval token is ever made up`);
      assert.equal(row.preAuth, undefined, `${t.name} in ${mode}: authorize is never skipped`);
      const gate = loaded.caps.get(t.cap)?.gate as { act?: string } | undefined;
      if (gate && gate.act !== "none") {
        assert.equal(out.kind, "held", `${t.name} in ${mode} must wait at the Gate`);
        if (out.kind === "held") { assert.ok(out.taskId.startsWith("task_")); assert.equal(out.result.ok, false); held++; }
      } else assert.equal(out.kind, "result", t.name);
    }
  }
  assert.ok(held >= 3 * 40, `${held} held calls across three modes`);
});

test("a held call is the turn waiting: no output reaches the model, only the task", async () => {
  const { session } = makeSession();
  const out = await session.call(ctx(), "mail_send", { to: "x" });
  assert.equal(out.kind, "held");
  if (out.kind !== "held") return;
  assert.deepEqual(out.result.content, { held: true, taskId: out.taskId, message: "Waiting for approval." });
});

test("only the Gate resume path supplies an approval token, and it reaches invoke unchanged", async () => {
  const { session, calls } = makeSession();
  const out = await session.call(ctx(), "mail_send", { to: "x" }, { approval: "tok_exact_payload" });
  assert.equal(out.kind, "result");
  assert.equal(calls.at(-1)?.approval, "tok_exact_payload");
});

test("local tools fail closed: no policy means refused, and invoke is never reached", async () => {
  const { session, calls } = makeSession();
  const out = await session.call(ctx(), "terminal_run", { command: "ls" });
  assert.equal(out.kind === "error" && out.error.code, "permission.role_lacks_permission");
  assert.equal(calls.length, 0);
});

test("Ask mode prompts for each local call; Allow and Auto run without a prompt; the owner's floor holds everyone to its strictness", async () => {
  const run = async (mode: SecurityMode, floor: SecurityMode, answer: boolean, facts: LocalFacts = {}) => {
    let asked = 0;
    const { session, calls } = makeSession({ localPolicy: (t) => decideLocal(t, mode, floor, facts), prompt: async () => { asked++; return answer; } });
    const out = await session.call(ctx(), "terminal_run", { command: "ls" });
    return { out, asked, calls: calls.length };
  };
  const ask = await run("ask", "auto", true);
  assert.deepEqual([ask.out.kind, ask.asked, ask.calls], ["result", 1, 1]);
  const denied = await run("ask", "auto", false);
  assert.deepEqual([denied.out.kind === "error" && denied.out.error.code, denied.asked, denied.calls], ["permission.needs_approval", 1, 0]);
  for (const m of ["allow", "auto"] as const) {
    const r = await run(m, "auto", false);
    assert.deepEqual([r.out.kind, r.asked, r.calls], ["result", 0, 1], m);
  }
  const floored = await run("auto", "ask", true);
  assert.deepEqual([floored.out.kind, floored.asked], ["result", 1], "a floor of ask beats a person's Auto");
});

test("Auto still asks for the always-ask list and keeps the work-folder wall", async () => {
  const cases: Array<[LocalFacts, "prompt" | "refuse"]> = [
    [{ deletesOutsideWork: true }, "prompt"],
    [{ movesMoney: true }, "prompt"],
    [{ floorMarked: true }, "prompt"],
    [{ outsideLockedFolder: true }, "refuse"],
    [{ outsideLockedFolder: true, movesMoney: true }, "refuse"],
  ];
  const terminal = loadGenerated().catalog.byName("terminal_run");
  assert.ok(terminal);
  for (const [facts, want] of cases) assert.equal(decideLocal(terminal, "auto", "auto", facts).action, want, JSON.stringify(facts));
  assert.equal(decideLocal(terminal, "auto", "auto").action, "run");
  assert.equal(decideLocal(terminal, "allow", "auto").action, "run");
  assert.equal(decideLocal(terminal, "allow", "ask").action, "prompt");
});

test("modes never apply to capability tools, and effectiveMode is the stricter of person and floor", () => {
  const { catalog } = loadGenerated();
  const records = catalog.byName("records_update") as ToolDef;
  for (const m of MODES) for (const f of MODES) assert.equal(decideLocal(records, m, f).action, "run");
  assert.equal(effectiveMode("auto", "ask"), "ask");
  assert.equal(effectiveMode("ask", "auto"), "ask");
  assert.equal(effectiveMode("allow", "auto"), "allow");
  assert.equal(effectiveMode("auto", "allow"), "allow");
  assert.ok(catalog.all.filter((t) => t.local !== "none").every((t) => t.local === "terminal" || t.local === "chrome" || t.local === "screen" || t.local === "files"));
  assert.ok(catalog.all.some((t) => t.local === "terminal"), "terminal_run is a local tool");
});
