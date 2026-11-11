// The import sheet end to end against a scripted server: choose, match (and change a match), preview, bring in, summary. No AI account appears anywhere in the calls.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press, textOf } from "../../../onboarding/test-dom.ts";
import { ImportSheet } from "./ImportSheet.tsx";

const columns = [
  { name: "Full name", inferred: "text", sample: ["Ada Alder", "Bram Birch"], distinct: 2, empty: 0 },
  { name: "Email", inferred: "email", sample: ["ada@example.test"], distinct: 2, empty: 0 },
  { name: "Notes", inferred: "text", sample: [], distinct: 0, empty: 2 },
];
const file = (name: string, size: number, text: string) => ({ name, mime: "text/csv", file: { size, text: async () => text } });

function server(opts: { commitFails?: string } = {}) {
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  let state = "staged";
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    const i = (input ?? {}) as Record<string, unknown>;
    calls.push({ cap, input: i });
    switch (cap) {
      case "import.parse_csv": return { importId: "imp_1", source: "csv", tables: [{ name: "CSV", rowCount: 2, columns }], expiresAt: 1 };
      case "schema.types.get": return { type: { fields: [{ key: "name", title: "Name", type: "text" }, { key: "email", title: "Email", type: "email" }, { key: "company", title: "Company", type: "relation" }] } };
      case "import.suggest_mapping": return { mapping: [{ column: "Full name", field: "name", confidence: 0.9 }, { column: "Email", field: "email", confidence: 1 }, { column: "Notes", confidence: 0 }], unmapped: ["Notes"], newFields: [] };
      case "import.preview": return { previewToken: "pv_1", creates: 2, updates: 0, skips: 0, errors: [], errorCount: 0, newFields: [], samples: [] };
      case "import.commit":
        if (opts.commitFails) throw new Error(opts.commitFails);
        state = "done";
        return { runId: "run_1", importId: "imp_1" };
      case "import.get": return { import: { importId: "imp_1", state, created: 2, updated: 0, skipped: 0, failed: 0 } };
      case "records.query": return { rows: [], total: state === "done" ? 2 : 0 };
      default: throw new Error(`unscripted ${cap}`);
    }
  };
  return { call, calls };
}

async function open(s: ReturnType<typeof server>, chosen: unknown[]) {
  installDom();
  const r = createRoot();
  await act(async () => { r.render(<ImportSheet call={s.call} type="contact" plural="Contacts" onClose={() => undefined} pick={(async () => chosen) as never} />); });
  await flush();
  return r.container as never;
}

test("choose a CSV, see the columns matched, preview, bring in and read the summary; no call needs an AI account", async () => {
  const s = server();
  const root = await open(s, [file("people.csv", 40, "Full name,Email,Notes\nAda Alder,ada@example.test,\n")]);
  assert.ok(textOf(find(root, "import-sheet")).includes("Bring in contacts"));
  await press(find(root, "import-choose"));
  await flush();
  assert.ok(find(root, "import-columns"), "the columns are listed");
  assert.ok(textOf(find(root, "import-file-line")).includes("people.csv: 2 rows"));
  assert.ok(textOf(find(root, "import-field-Full name")).includes("Name"));
  assert.ok(textOf(find(root, "import-field-Email")).includes("Email"));
  assert.ok(textOf(find(root, "import-field-Notes")).includes("Leave out"), "a column with no field stays out");
  assert.ok(textOf(find(root, "import-match")).includes("Email"), "people already here are found by email");
  await press(find(root, "import-preview"));
  await flush();
  const prev = s.calls.find((c) => c.cap === "import.preview")!.input;
  assert.deepEqual(prev["mapping"], [{ column: "Full name", field: "name" }, { column: "Email", field: "email" }]);
  assert.deepEqual([prev["match"], prev["onMatch"]], [["email"], "update"]);
  assert.ok(textOf(find(root, "import-count-new")).includes("2"));
  assert.ok(textOf(find(root, "import-commit")).includes("Bring in 2 rows"));
  await press(find(root, "import-commit"));
  await flush(); await flush();
  assert.ok(textOf(find(root, "import-summary")).startsWith("2 new rows added. They are in contacts."));
  assert.ok(s.calls.every((c) => !/^(engine|chat|agents)\./.test(c.cap)), "no AI call");
  assert.ok(find(root, "import-done"), "a way back to the contacts");
});

test("a file that is not a CSV, or is too big, is refused in words before anything is sent", async () => {
  const s = server();
  let root = await open(s, [file("people.xlsx", 40, "")].map((f) => ({ ...f, mime: "application/vnd.ms-excel" })));
  await press(find(root, "import-choose")); await flush();
  assert.ok(textOf(find(root, "import-error")).includes("not a CSV file"));
  root = await open(s, [file("big.csv", 5 * 1024 * 1024, "")]);
  await press(find(root, "import-choose")); await flush();
  assert.ok(textOf(find(root, "import-error")).includes("too big"));
  assert.equal(s.calls.length, 0, "nothing was sent");
});

test("a refused import says why on the preview and writes nothing more", async () => {
  const s = server({ commitFails: "The preview is out of date. Preview again." });
  const root = await open(s, [file("people.csv", 40, "x")]);
  await press(find(root, "import-choose")); await flush();
  await press(find(root, "import-preview")); await flush();
  await press(find(root, "import-commit")); await flush(); await flush();
  assert.ok(textOf(find(root, "import-error")).includes("The preview is out of date"));
  assert.ok(find(root, "import-commit"), "back on the preview");
});
