// Two things an agent asks for through the runs tool wait for a person's yes (r42-runtime): saving finished work as an agent, and raising a spending limit (an agent giving itself more of the Space's money), through runs.ops and through
// runs.budget.set itself. A person's own press, a lower limit and the first limit go straight through; so does everything else the tool does. The real Gate conditions (host/src/daemon/gate-hook.ts moduleWhens), the real
// budgetRaise over a real SQLite with the runs migrations.
// @reads ../modules/runs/migrations/0006_run_nodes.sql
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { moduleWhens } from "../host/src/daemon/gate-hook.ts";
import { budgetRaise } from "../modules/runs/impl.ts";
import { wantsFromInput } from "../lib/hold-words.ts";
import type { CtxSeed } from "../host/src/invoke.ts";

function world() {
  const raw = new DatabaseSync(":memory:");
  const dir = new URL("../modules/runs/migrations/", import.meta.url);
  for (const f of fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".sql"))
    .sort())
    raw.exec(fs.readFileSync(new URL(f, dir), "utf8"));
  const db = {
    all: (q: string, ...a: unknown[]) => raw.prepare(q).all(...(a as never[])),
    run: (q: string, ...a: unknown[]) => ({ changes: Number(raw.prepare(q).run(...(a as never[])).changes) }),
  };
  const node = (id: string, budget: unknown): void => {
    const cols = (
      raw.prepare("PRAGMA table_info(runs_node)").all() as Array<{ name: string; notnull: number; dflt_value: unknown }>
    )
      .filter((c) => c.notnull === 1 && c.dflt_value === null)
      .map((c) => c.name);
    const vals: Record<string, unknown> = {
      run_id: id,
      root_run: id,
      depth: 0,
      kind: "turn",
      owner: "usr_1",
      started_by: "usr_1",
      who_kind: "agent",
      status: "running",
      version: 0,
      attempt: 1,
      started_at: 1,
      updated_at: 1,
      spent_json: "{}",
    };
    const names = [...new Set(["run_id", ...cols, "budget_json"])];
    raw
      .prepare(`INSERT INTO runs_node (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`)
      .run(
        ...(names.map((n) =>
          n === "budget_json" ? (budget === null ? null : JSON.stringify(budget)) : (vals[n] ?? null),
        ) as never[]),
      );
  };
  node("run_limited", { usdMicros: 1_000_000, tokens: 10_000 });
  node("run_free", null);
  const when = moduleWhens(
    new Map([["runs", { budgetRaise }]]),
    () => db as never,
    async () => null,
  ) as Record<string, (input: unknown, seed: CtxSeed) => boolean | Promise<boolean>>;
  return { when };
}
const agent = { principal: { kind: "agent", id: "agt_1" } } as unknown as CtxSeed;
const person = { principal: { kind: "person", id: "usr_1" } } as unknown as CtxSeed;
const direct = (runId: string, over: Record<string, unknown>) => ({ runId, ...over });
const viaOps = (id: string, args: Record<string, unknown>) => ({ action: "budget", id, args });

test("runs.budget.set and runs.ops budget: an agent raising a limit is held; an agent lowering it, setting the first one or asking the same is not; a person raising it is not", async () => {
  const w = world();
  for (const [name, gate, make] of [
    ["runs.budget.set", "runs.budget_raise_gate", direct],
    ["runs.ops budget", "runs.ops_gate", viaOps],
  ] as const) {
    const g = w.when[gate]!;
    const raise = (over: Record<string, unknown>) => make("run_limited", over) as never;
    assert.equal(await g(raise({ usdMicros: 5_000_000 }), agent), true, `${name}: a bigger money limit, agent`);
    assert.equal(await g(raise({ tokens: 50_000 }), agent), true, `${name}: a bigger token limit, agent`);
    assert.equal(
      await g(raise({ usdMicros: 500_000, tokens: 10_000 }), agent),
      false,
      `${name}: lower money, same tokens`,
    );
    assert.equal(await g(raise({ usdMicros: 1_000_000, tokens: 10_000 }), agent), false, `${name}: the same limit`);
    assert.equal(await g(raise({ clear: true }), agent), true, `${name}: taking the limit away is a raise`);
    assert.equal(await g(raise({ usdMicros: 5_000_000 }), person), false, `${name}: a person raising, not held`);
    assert.equal(await g(raise({ clear: true }), person), false);
    assert.equal(
      await g(make("run_free", { usdMicros: 5_000_000 }) as never, agent),
      false,
      `${name}: the first limit only reduces`,
    );
    assert.equal(
      await g(make("run_none", { usdMicros: 5_000_000 }) as never, agent),
      false,
      `${name}: no such work is the handler's to refuse`,
    );
  }
});

test("runs.ops: save_as_agent is held for an agent and not for a person; every other action goes through for both", async () => {
  const g = world().when["runs.ops_gate"]!;
  assert.equal(await g({ action: "save_as_agent", id: "run_a1" }, agent), true);
  assert.equal(await g({ action: "save_as_agent", id: "run_a1" }, person), false);
  for (const a of [
    "tree",
    "tree_find",
    "node",
    "node_find",
    "compare",
    "events",
    "messages",
    "activity",
    "board",
    "message_send",
    "board_put",
    "board_answer",
    "control",
    "rerun",
  ])
    assert.equal(await g({ action: a, id: "run_limited" }, agent), false, `${a} is not held`);
  assert.equal(await g(null, agent), false, "no input holds nothing");
  assert.equal(await g({}, agent), false);
});

test("a limit this cannot read holds: with no runs module behind it an agent's raise waits, a person's does not", async () => {
  const bare = moduleWhens(
    new Map(),
    () => null as never,
    async () => null,
  ) as Record<string, (input: unknown, seed: CtxSeed) => boolean | Promise<boolean>>;
  assert.equal(await bare["runs.budget_raise_gate"]!(direct("run_limited", { usdMicros: 1 }), agent), true);
  assert.equal(await bare["runs.budget_raise_gate"]!(direct("run_limited", { usdMicros: 1 }), person), false);
});

test("the card says how much more the work may spend, through either door, and what saving makes", () => {
  assert.equal(
    wantsFromInput("runs.budget.set", { runId: "run_a", usdMicros: 5_000_000 }),
    "let this work spend up to $5.00",
  );
  assert.equal(
    wantsFromInput("runs.ops", { action: "budget", id: "run_a", args: { usdMicros: 2_500_000, tokens: 200_000 } }),
    "let this work spend up to $2.50 and use up to 200,000 tokens",
  );
  assert.equal(
    wantsFromInput("runs.budget.set", { runId: "run_a", clear: true }),
    "let this work spend without a limit",
  );
  assert.equal(
    wantsFromInput("runs.ops", { action: "save_as_agent", id: "run_a" }),
    "make an agent from finished work",
  );
});
