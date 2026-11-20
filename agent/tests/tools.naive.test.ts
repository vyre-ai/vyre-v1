// The first-call ratchet (13 Nov 2026, owner: "for everything its first attempts are failing always"). For every tool the catalog holds there is one naive first call in agent/tests/golden/naive-calls.json:
// what a capable model writes from the tool's description and the inputs it is shown, with nothing else. Each is sent through the tool layer to the real input validators (the pipeline's steps 2 and 3), and
// must be ACCEPTED. A refusal for permission is another matter and is not tested here. A new tool with no naive call, or a naive call the validators refuse, is red.
// Regenerate missing entries with `node scripts/naive-calls.ts`; an entry may be edited by hand where the generator cannot know a value.
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { createToolSession } from "../src/tools/index.ts";
import { loadGenerated, validatingInvoke } from "../src/tools/harness.ts";
import { validateInput } from "../../generated/validators.ts";
import type { ToolCtx } from "../src/tools/types.ts";

const golden = JSON.parse(readFileSync(new URL("./golden/naive-calls.json", import.meta.url), "utf8")) as Record<
  string,
  Record<string, unknown>
>;
const loaded = loadGenerated();

test("every tool has a naive first call, and none is left over", () => {
  const names = loaded.catalog.all.map((t) => t.name).sort();
  assert.deepEqual(
    names.filter((n) => !(n in golden)),
    [],
    "tools with no naive call: run node scripts/naive-calls.ts",
  );
  assert.deepEqual(
    Object.keys(golden).filter((n) => !loaded.catalog.byName(n)),
    [],
    "naive calls for tools that are gone",
  );
});

test("a naive call holds no input the model cannot know: no idempotency key", () => {
  for (const [n, call] of Object.entries(golden)) assert.equal("idempotencyKey" in call, false, n);
});

test("every naive first call is accepted by validation through the tool layer", async (t) => {
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
  const ctx: ToolCtx = {
    space: "spc_1",
    agentId: "agt_intake",
    asker: "usr_dana",
    thread: { threadId: "thr_current1", kind: "chat", planMode: false },
    turnId: "trn_naive",
  };
  s.preload(
    "thr_current1",
    loaded.catalog.all.map((x) => x.name),
  );
  const bad: string[] = [];
  let before = 0;
  for (const tool of loaded.catalog.all) {
    const call = golden[tool.name] ?? {};
    const raw = validateInput(tool.cap, tool.v, call);
    if (raw.length > 0) before++;
    const out = await s.call({ ...ctx, turnId: `trn_${tool.name}` }, tool.name, call);
    if (out.kind === "error" && out.error.code === "validation.bad_input")
      bad.push(`${tool.name}: ${JSON.stringify((out.error.details as { errors?: unknown } | undefined)?.errors)}`);
  }
  t.diagnostic(
    `naive first calls refused by validation: ${before} of ${loaded.catalog.all.length} before the tool layer fills, ${bad.length} after`,
  );
  assert.deepEqual(bad, []);
});

// The count the owner asked for (16 Nov 2026): for every tool, the first call a model writes from the tool's description alone works, or is refused for a reason a person would accept (no access), never for a missing
// key, an input the tool does not have, an id of a shape the tool never showed, or a size the description did not state.
test("every tool's first call passes: no key, no unknown input, no id shape unshown, no size unstated", async (t) => {
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
  s.preload(
    "thr_current1",
    loaded.catalog.all.map((x) => x.name),
  );
  type P = {
    pattern?: string;
    examples?: unknown[];
    description?: string;
    maxLength?: number;
    maxItems?: number;
    properties?: Record<string, P>;
    items?: P;
    required?: string[];
  };
  const failures: string[] = [];
  const walk = (tool: string, p: P, at: string): void => {
    if (p.maxLength !== undefined && p.maxLength >= 500 && !(p.description ?? "").includes(`Max ${p.maxLength}`))
      failures.push(`${tool}${at}: a limit of ${p.maxLength} characters is not stated`);
    if (p.maxItems !== undefined && p.maxItems >= 100 && !(p.description ?? "").includes(`Max ${p.maxItems}`))
      failures.push(`${tool}${at}: a limit of ${p.maxItems} items is not stated`);
    for (const k of p.required ?? []) {
      const c = p.properties?.[k];
      if (c?.pattern !== undefined && /^\^[a-z]{2,6}_/.test(c.pattern) && !(c.examples?.length ?? 0))
        failures.push(`${tool}${at}.${k}: an id shape with no example`);
    }
    for (const [k, c] of Object.entries(p.properties ?? {})) walk(tool, c, `${at}.${k}`);
    if (p.items) walk(tool, p.items, `${at}[]`);
  };
  let pass = 0;
  for (const tool of loaded.catalog.all) {
    const schema = tool.inputSchema as P;
    walk(tool.name, schema, "");
    if (JSON.stringify(schema).includes('"idempotencyKey"')) failures.push(`${tool.name}: the key is shown`);
    const out = await s.call(
      {
        space: "spc_1",
        agentId: "agt_intake",
        asker: "usr_dana",
        thread: { threadId: "thr_current1", kind: "chat", planMode: false },
        turnId: `trn_all_${tool.name}`,
        callId: "toolu_1",
      },
      tool.name,
      golden[tool.name] ?? {},
    );
    if (
      out.kind === "error" &&
      (out.error.code === "validation.bad_input" || out.error.code === "validation.not_found")
    )
      failures.push(`${tool.name}: its first call is refused: ${String(out.error.message).slice(0, 200)}`);
    else pass++;
  }
  t.diagnostic(`first calls: ${loaded.catalog.all.length} tools, ${pass} first calls pass`);
  console.log(`first calls: ${loaded.catalog.all.length} tools, ${pass} first calls pass`);
  assert.deepEqual(failures, []);
});

test("documents_make_pdf is an agent tool, and the naive first call (a file and a folder) is what it takes", () => {
  const tool = loaded.catalog.byName("documents_make_pdf");
  assert.ok(tool, "offered to agents");
  assert.deepEqual(golden["documents_make_pdf"], { fileId: "fil_a1b2c3", intoFolderId: "fld_a1b2c3" });
  assert.deepEqual((tool.inputSchema as { required?: string[] }).required?.filter((k) => k !== "idempotencyKey").sort(), [
    "fileId",
    "intoFolderId",
  ]);
});
