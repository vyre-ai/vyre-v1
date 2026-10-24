// The generated contract for reports-client, run against the REAL handlers: the same example inputs and outputs the stub answered with
// (generated/modules/reports-client/stub-impl.ts), checked against the registry's schemas. This is the evidence for flipping reports-client to live (ARCH 12.4).
// @reads /generated/registry.json
// @reads ../migrations/0001_init.sql

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sample, validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import { NOW, trace, world } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";
import { configureReports, handlers } from "../handlers/index.ts";
import type { Bundle, ReportsCtx } from "../handlers/index.ts";

interface RegCap {
  name: string; module: string; v: number; input: JsonSchema; output: JsonSchema; emits: string[];
  examples: { name: string; input: unknown; output: unknown }[];
}
interface RegEvent { name: string; module: string; payload: JsonSchema }
interface Registry { $defs: Record<string, JsonSchema>; capabilities: RegCap[]; events: RegEvent[] }

const registry = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as Registry;
const defs = registry.$defs;
const caps = registry.capabilities.filter((c) => c.module === "reports-client");
const eventSchemas = new Map(registry.events.filter((e) => e.module === "reports-client").map((e) => [e.name, e.payload]));

/** The id every example and schema sample names. */
const EXAMPLE_REPORT = "rpt_a1b2c3";

type Fn = (ctx: ReportsCtx, input: never) => Promise<unknown>;
const run = (name: string, ctx: ReportsCtx, input: unknown): Promise<unknown> => {
  const fn = (handlers as unknown as Record<string, Fn>)[name];
  assert.ok(fn, `a handler for ${name}`);
  return fn(ctx, input as never);
};

const bundle: Bundle = {
  context: { place: "Records", itemId: "rec_a1b2" },
  traceIds: [trace(1)], events: [{ type: "records.update", at: NOW, traceId: trace(1) }],
  versions: { app: "1.2.0", server: "1.2.1", device: "mac-14" }, note: "blank page",
  errors: [{ code: "provider.network", message: "could not reach the model", at: NOW, traceId: trace(1) }],
};

/** A Space with one report under the id the examples use: sent to the Vyre team as issue 1, so it can be read, listed and resolved. The caller is an admin. */
function populated(): World {
  const w = world({ name: "Omar" });
  configureReports(w.drivers);
  w.raw.run(
    "INSERT INTO reports_report (report_id, title, status, reporter, at, trace_ids, bundle_json, redactions, task_id, issue_number, sent_at, fixed_in) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    EXAMPLE_REPORT, "Problem report from Omar", "sent", "usr_omar", NOW, JSON.stringify(bundle.traceIds), JSON.stringify(bundle), 0, "tsk_seed", 1, NOW, null,
  );
  return w;
}

afterEach(() => configureReports(null));

test("a real handler exists for exactly the capabilities the registry declares for reports-client", () => {
  assert.equal(caps.length, 9);
  assert.deepEqual(Object.keys(handlers).sort(), caps.map((c) => c.name).sort());
});

for (const cap of caps) {
  const name = `${cap.name}@${cap.v}`;

  test(`${name}: real handler answers the example input with a valid output`, async () => {
    assert.ok(cap.examples.length >= 1);
    for (const ex of cap.examples) {
      assert.deepEqual(validate(cap.input, ex.input, "", defs), [], `example ${ex.name} input is valid`);
      const w = populated();
      const out = await run(cap.name, w.ctx, ex.input);
      assert.deepEqual(validate(cap.output, out, "", defs), [], `example ${ex.name} output`);
      for (const e of w.events.filter((x) => !w.nested.includes(x))) {
        assert.ok(cap.emits.includes(e.name), `${e.name} is declared in emits of ${cap.name}`);
        const schema = eventSchemas.get(e.name);
        assert.ok(schema, `${e.name} has a schema`);
        assert.deepEqual(validate(schema, e.payload, "", defs), [], `${e.name} payload`);
      }
    }
  });

  test(`${name}: real handler answers the schema sample with a valid output`, async () => {
    const input = sample(cap.input, 0, defs);
    assert.deepEqual(validate(cap.input, input, "", defs), []);
    const w = populated();
    const out = await run(cap.name, w.ctx, input);
    assert.deepEqual(validate(cap.output, out, "", defs), []);
  });
}

test("every declared event is emitted by the handler that declares it", async () => {
  const emitted = async (cap: string, input: unknown, prep?: (w: World) => void): Promise<string[]> => {
    const w = populated();
    prep?.(w);
    await run(cap, w.ctx, input);
    for (const e of w.events) assert.deepEqual(validate(eventSchemas.get(e.name)!, e.payload, "", defs), [], `${e.name} payload`);
    return [...new Set(w.events.map((e) => e.name))].sort();
  };
  // submit announces the report; the post it makes (policy On) is its own call and announces itself
  assert.deepEqual(await emitted("reports.submit", { bundle }), ["report.sent_to_vyre", "report.submitted"]);
  assert.deepEqual(await emitted("reports.submit", { bundle }, (w) => { w.settings.set("reports.vyre", "ask"); }), ["report.submitted"]);
  assert.deepEqual(await emitted("reports.resolved", { reportId: EXAMPLE_REPORT, issueNumber: 1 }), ["report.resolved"]);
  const fresh = async (): Promise<string[]> => {
    const w = populated();
    w.raw.run("UPDATE reports_report SET status = ?, issue_number = ?, sent_at = ? WHERE report_id = ?", "new", null, null, EXAMPLE_REPORT);
    await run("reports.send_to_vyre", w.ctx, { reportId: EXAMPLE_REPORT });
    return w.events.map((e) => e.name);
  };
  assert.deepEqual(await fresh(), ["report.sent_to_vyre"]);
  for (const c of caps.filter((x) => x.emits.length === 0)) assert.deepEqual(await emitted(c.name, sample(c.input, 0, defs)), [], c.name);
  assert.deepEqual([...new Set(caps.flatMap((c) => c.emits))].sort(), ["report.resolved", "report.sent_to_vyre", "report.submitted"]);
});
