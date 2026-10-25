// The contract of the import module against its real handlers (ARCH 12.4: a module goes live only when the contract holds for the handlers, not the stubs): the handler table covers exactly the
// frozen capabilities, each example input is accepted and each answer conforms to its output schema, every error a handler raises is one the capability declares, and every event it emits is
// one it declares, with a payload that matches the frozen event schema.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { handlers } from "../impl.ts";
import { assertEventsConform, codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { CSV, MAPPING, makeXlsx, run, stage } from "../fixtures/seed.ts";

const mine = registry.capabilities.filter((c) => c.module === "import");

test("the handler table covers exactly the 12 capabilities of the import manifest", () => {
  assert.equal(mine.length, 12);
  assert.deepEqual(Object.keys(handlers).sort(), mine.map((c) => c.name).sort());
  for (const c of mine) assert.equal(typeof handlers[c.name], "function", c.name);
});

test("each example input is a valid input", () => {
  for (const c of mine) for (const ex of c.examples) assert.deepEqual(contractErrors(c.name, "in", ex.input), [], `${c.name}: example ${ex.name}`);
});

interface Scenario { cap: string; setup?: (hn: Harness) => Promise<any> | any; run: (hn: Harness, s: any) => Promise<unknown> | unknown; expect?: string }   // eslint-disable-line @typescript-eslint/no-explicit-any

const staged = (hn: Harness) => stage(hn);
const previewed = async (hn: Harness) => { const importId = await stage(hn); const p = await run(hn, "import.preview", { importId, type: "contact", mapping: MAPPING }); return { importId, previewToken: p.previewToken as string }; };
const TOKEN = "vit_key";
const airtable = (hn: Harness, status = 200): void => {
  hn.world.secrets.set(TOKEN, "k");
  hn.world.routes.push(
    { match: (u) => u.includes("/meta/bases/"), answer: () => (status === 200 ? { status, json: { tables: [{ id: "tblAAAAAAAA01", name: "Leads", fields: [{ name: "Name" }] }] } } : { status }) },
    { match: (u) => u.includes("/v0/appABCDEFGH123/tbl"), answer: () => ({ status: 200, json: { records: [{ fields: { Name: "Ada" } }] } }) },
  );
};

const scenarios: Scenario[] = [
  { cap: "import.parse_csv", run: (hn) => run(hn, "import.parse_csv", { text: CSV, delimiter: ",", hasHeader: true }) },
  { cap: "import.parse_csv", run: (hn) => run(hn, "import.parse_csv", {}), expect: "validation.bad_input" },
  { cap: "import.parse_excel", setup: (hn) => hn.world.file(makeXlsx({ A: [["x"], ["1"]] })), run: (hn, id) => run(hn, "import.parse_excel", { fileId: id, sheets: ["A"] }) },
  { cap: "import.parse_excel", run: (hn) => run(hn, "import.parse_excel", { fileId: "fil_none" }), expect: "validation.not_found" },
  { cap: "import.parse_excel", setup: (hn) => hn.world.file("text"), run: (hn, id) => run(hn, "import.parse_excel", { fileId: id }), expect: "validation.bad_input" },
  { cap: "import.parse_airtable", setup: (hn) => airtable(hn), run: (hn) => run(hn, "import.parse_airtable", { baseUrl: "https://airtable.com/appABCDEFGH123", key: TOKEN }) },
  { cap: "import.parse_airtable", setup: (hn) => airtable(hn, 401), run: (hn) => run(hn, "import.parse_airtable", { baseUrl: "https://airtable.com/appABCDEFGH123", key: TOKEN }), expect: "provider.auth_failed" },
  { cap: "import.parse_airtable", setup: (hn) => airtable(hn, 503), run: (hn) => run(hn, "import.parse_airtable", { baseUrl: "https://airtable.com/appABCDEFGH123", key: TOKEN }), expect: "provider.unavailable" },
  { cap: "import.parse_notion", setup: (hn) => hn.world.file("Name\nAda\n"), run: (hn, id) => run(hn, "import.parse_notion", { exportFileId: id }) },
  { cap: "import.parse_notion", run: (hn) => run(hn, "import.parse_notion", {}), expect: "validation.bad_input" },
  { cap: "import.parse_google_sheets", setup: (hn) => hn.world.sheets.set("abc", { sheets: [{ title: "T", values: [["a"], ["1"]] }] }), run: (hn) => run(hn, "import.parse_google_sheets", { url: "https://docs.google.com/spreadsheets/d/abc/edit" }) },
  { cap: "import.parse_google_sheets", run: (hn) => run(hn, "import.parse_google_sheets", { url: "https://docs.google.com/spreadsheets/d/none/edit" }), expect: "provider.auth_failed" },
  { cap: "import.suggest_mapping", setup: staged, run: (hn, id) => run(hn, "import.suggest_mapping", { importId: id, type: "contact" }) },
  { cap: "import.suggest_mapping", run: (hn) => run(hn, "import.suggest_mapping", { importId: "imp_none", type: "contact" }), expect: "validation.not_found" },
  { cap: "import.preview", setup: staged, run: (hn, id) => run(hn, "import.preview", { importId: id, type: "contact", mapping: MAPPING, match: ["email"], onMatch: "update", runAutomations: false }) },
  { cap: "import.preview", setup: staged, run: (hn, id) => run(hn, "import.preview", { importId: id, type: "contact", mapping: [] }), expect: "validation.bad_input" },
  { cap: "import.preview", run: (hn) => run(hn, "import.preview", { importId: "imp_none", type: "contact", mapping: MAPPING }), expect: "validation.not_found" },
  { cap: "import.commit", setup: previewed, run: (hn, s) => run(hn, "import.commit", s) },
  { cap: "import.commit", setup: previewed, run: (hn, s) => run(hn, "import.commit", { ...s, previewToken: "pv_wrong" }), expect: "validation.precondition_failed" },
  { cap: "import.get", setup: staged, run: (hn, id) => run(hn, "import.get", { importId: id }) },
  { cap: "import.get", run: (hn) => run(hn, "import.get", { importId: "imp_none" }), expect: "validation.bad_input" },
  { cap: "import.list", setup: staged, run: (hn) => run(hn, "import.list", { type: "contact", limit: 5 }) },
  { cap: "import.discard", setup: staged, run: (hn, id) => run(hn, "import.discard", { importId: id }) },
  { cap: "import.discard", run: (hn) => run(hn, "import.discard", { importId: "imp_none" }), expect: "validation.bad_input" },
  { cap: "import.template", run: (hn) => run(hn, "import.template", { type: "contact" }) },
  { cap: "import.template", run: (hn) => run(hn, "import.template", { type: "nothing" }), expect: "validation.not_found" },
];

test("every path through every capability: answers match the schema, errors are declared, events are declared and match their schemas", async () => {
  let happy = 0, unhappy = 0;
  const covered = new Set<string>();
  for (const s of scenarios) {
    const cap = mine.find((c) => c.name === s.cap)!;
    const hn = harness();
    const state = s.setup ? await s.setup(hn) : undefined;
    hn.emitted.length = 0;
    let out: unknown;
    let code: string | null = null;
    try { out = await s.run(hn, state); } catch (e) { code = codeOf(e); }
    if (s.expect !== undefined) {
      unhappy++;
      assert.equal(code, s.expect, `${s.cap}: expected ${s.expect}`);
      assert.ok((cap.errors as readonly string[]).includes(s.expect), `${s.cap} does not declare ${s.expect}`);
    } else {
      happy++;
      covered.add(s.cap);
      assert.equal(code, null, `${s.cap} raised ${String(code)}`);
      assert.deepEqual(contractErrors(s.cap, "out", out), [], `${s.cap}: answer`);
    }
    for (const e of hn.emitted) assert.ok((cap.emits as readonly string[]).includes(e.name), `${s.cap} emitted undeclared ${e.name}`);
    assert.deepEqual(assertEventsConform(hn), [], s.cap);
  }
  assert.deepEqual([...covered].sort(), mine.map((c) => c.name).sort(), "every capability has a happy path");
  assert.ok(happy >= 12 && unhappy >= 12, `${happy} happy, ${unhappy} unhappy`);
});

test("only commit raises events, and they are the declared ones", async () => {
  const hn = harness();
  const before = hn.emitted.length;
  const id = await stage(hn);
  await run(hn, "import.suggest_mapping", { importId: id, type: "contact" });
  const p = await run(hn, "import.preview", { importId: id, type: "contact", mapping: MAPPING });
  await run(hn, "import.get", { importId: id });
  await run(hn, "import.list", {});
  await run(hn, "import.template", { type: "contact" });
  assert.equal(hn.emitted.length, before, "parse, suggest, preview and the reads raise nothing");
  await run(hn, "import.commit", { importId: id, previewToken: p.previewToken });
  assert.deepEqual(hn.names(), ["import.started", "import.completed"]);
  assert.deepEqual(assertEventsConform(hn), []);
});
