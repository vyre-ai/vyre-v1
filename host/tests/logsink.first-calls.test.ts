// The first-call read (13 Nov 2026): per tool, over a period, how many first calls were refused, for which inputs and rules, and how many retries worked. It reads only the rows the invoke pipeline writes
// (host/src/invoke.ts: `invoke` rows with fields, tool and first; `invoke.retry_ok`), so what it shows is names and rules, never a value.
import test from "node:test";
import assert from "node:assert/strict";
import { LogSink } from "../src/logsink/index.ts";
import { firstCallReport } from "../src/logsink/first-calls.ts";

function sink() {
  let t = 1_000;
  const s = new LogSink({ now: () => t, batchMs: 0 });
  const row = (msg: string, attrs: Record<string, unknown>, result?: string) =>
    s.log({
      space: "spc_1",
      level: 30,
      msg,
      place: "invoke",
      ...(result ? { result } : {}),
      attrs,
      cap: String(attrs["cap"] ?? "x"),
    });
  return { s, row, tick: (n: number) => (t += n) };
}

test("per tool: first calls refused, the inputs and rules, other refusals, and retries that worked", () => {
  const { s, row } = sink();
  const bad = [{ path: "/title", rule: "required" }];
  row(
    "invoke",
    { cap: "sites.artifact_publish", tool: "artifact_publish", first: true, fields: bad },
    "validation.bad_input",
  );
  row(
    "invoke",
    { cap: "sites.artifact_publish", tool: "artifact_publish", first: true, fields: bad },
    "validation.bad_input",
  );
  row(
    "invoke",
    { cap: "sites.artifact_publish", tool: "artifact_publish", first: false, fields: bad },
    "validation.bad_input",
  );
  row("invoke.retry_ok", { cap: "sites.artifact_publish", tool: "artifact_publish", first: false });
  row("invoke", { cap: "vault.use", tool: "vault_use", first: true }, "permission.above_clearance");
  row("invoke", { cap: "files.list", first: true }, "validation.bad_input"); // not made by a tool: no tool name, not counted
  s.flush();
  const r = firstCallReport(s.db, 0);
  const pub = r.find((x) => x.tool === "artifact_publish");
  assert.deepEqual(pub, {
    tool: "artifact_publish",
    firstRefused: 2,
    laterRefused: 1,
    retriedOk: 1,
    byInput: [{ path: "/title", rule: "required", n: 3 }],
    byCode: { "validation.bad_input": 3 },
  });
  const vault = r.find((x) => x.tool === "vault_use");
  assert.equal(vault?.firstRefused, 1);
  assert.deepEqual(vault?.byCode, { "permission.above_clearance": 1 });
  assert.deepEqual(vault?.byInput, []);
  assert.equal(
    r.find((x) => x.tool === undefined),
    undefined,
  );
  assert.equal(r[0]?.tool, "artifact_publish", "the most refused first");
});

test("only rows inside the period count", () => {
  const { s, row, tick } = sink();
  row("invoke", { cap: "a.b", tool: "old_tool", first: true }, "validation.bad_input");
  tick(10_000);
  row("invoke", { cap: "a.b", tool: "new_tool", first: true }, "validation.bad_input");
  s.flush();
  assert.deepEqual(
    firstCallReport(s.db, 5_000).map((x) => x.tool),
    ["new_tool"],
  );
});
