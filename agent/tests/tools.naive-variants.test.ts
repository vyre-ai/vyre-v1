// The other first calls (16 Nov 2026, finding F93). agent/tests/golden/naive-calls.json holds the one call a model writes from a tool's inputs; this holds the calls it writes when it does not know the folder or the
// shape of the text: a file with no folder, a path, a folder by name, the text as `content` or `text`, a date written with slashes. Each is sent through the tool layer to the real validators and must reach the
// capability as the tool's own input (the folder is the person's own files, the text is in content.text). A new case goes in the json.
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { createToolSession } from "../src/tools/index.ts";
import { loadGenerated, validatingInvoke } from "../src/tools/harness.ts";
import type { ToolCtx } from "../src/tools/types.ts";

type Case = {
  tool: string;
  input: Record<string, unknown>;
  sent: { cap: string; has?: Record<string, unknown>; lacks?: string[] };
};
const cases = JSON.parse(readFileSync(new URL("./golden/naive-variants.json", import.meta.url), "utf8")) as Record<
  string,
  Case
>;
const loaded = loadGenerated();

test("every other first call reaches the capability as the tool's own input", async (t) => {
  let passed = 0;
  for (const [label, k] of Object.entries(cases)) {
    const { invoke, sent } = validatingInvoke(loaded.caps);
    const s = createToolSession({
      catalog: loaded.catalog,
      defaults: loaded.defaults,
      invoke,
      levelFor: () => "manage",
      canEngineer: () => true,
      localPolicy: () => ({ action: "run" }) as never,
      traceId: () => "trace_fixed",
    });
    const ctx: ToolCtx = {
      space: "spc_1",
      agentId: "agt_intake",
      asker: "usr_dana",
      thread: { threadId: "thr_current1", kind: "chat", planMode: false },
      turnId: "trn_variants",
      callId: "toolu_1",
    };
    s.preload("thr_current1", [k.tool]);
    const out = await s.call(ctx, k.tool, k.input);
    assert.equal(out.kind, "result", `${label}: ${JSON.stringify(out.kind === "error" ? out.result.content : out)}`);
    const last = sent.filter((x) => x.cap === k.sent.cap).at(-1);
    assert.ok(last, `${label}: ${k.sent.cap} was called`);
    const input = last.input as Record<string, unknown>;
    for (const [key, v] of Object.entries(k.sent.has ?? {})) assert.deepEqual(input[key], v, `${label}: ${key}`);
    for (const key of k.sent.lacks ?? []) assert.equal(key in input, false, `${label}: no ${key}`);
    passed++;
  }
  t.diagnostic(`naive variants: ${passed} of ${Object.keys(cases).length} reach the capability as the tool's own input`);
});

test("a write to a path nothing is at says what to call, in one plain sentence", async () => {
  const { invoke } = validatingInvoke(loaded.caps);
  const s = createToolSession({
    catalog: loaded.catalog,
    defaults: loaded.defaults,
    invoke,
    levelFor: () => "manage",
    canEngineer: () => true,
    localPolicy: () => ({ action: "run" }) as never,
    traceId: () => "trace_fixed",
  });
  s.preload("thr_current1", ["files_write"]);
  const out = await s.call(
    { space: "spc_1", agentId: "agt_intake", asker: "usr_dana", thread: { threadId: "thr_current1", kind: "chat", planMode: false } },
    "files_write",
    // the fake finds a path with a dot in its last part, so a path with none is "nothing there"
    { path: "Reports/missing", content: { text: "x" } },
  );
  assert.equal(out.kind, "error");
  const words = JSON.stringify(out.kind === "error" ? out.result.content : "");
  assert.match(words, /no file at that path/);
  assert.match(words, /files_create/);
});
