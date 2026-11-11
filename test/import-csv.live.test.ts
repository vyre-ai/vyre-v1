// Bring a spreadsheet of contacts in with no AI account (client walk, 11 Nov 2026): the owner stages a CSV, takes the suggested mapping, previews, commits and the people are in Records, where a member sees them.
// Runs on a server-role daemon with the real import, schema and records modules. A second CSV of 20,000 rows is timed.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, invite, join, waitFor } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";

let h: Hour;
let aina: Person;
const first = ["Ada", "Bram", "Cleo", "Dara", "Eli", "Fenn", "Gia", "Hale", "Iris", "Jory"], last = ["Alder", "Birch", "Cedar", "Dunmore", "Elm", "Fairweather", "Grove", "Hawthorn"];
const csv = (n: number): string => ["Full name,Email,Phone,Company,Job title", ...Array.from({ length: n }, (_, i) => `${first[i % 10]} ${last[i % 8]}${i},${first[i % 10]!.toLowerCase()}.${i}@example.test,+1 555 01${String(i % 100).padStart(2, "0")},Org ${i % 25},Role ${i % 7}`)].join("\n");

before(async () => { h = await bootHour("import"); });
after(async () => { await h?.stop(); });

async function run(rows: number, key: string): Promise<{ ms: number; preview: Record<string, unknown>; runId: string; contactType: string; fieldKeys: string[] }> {
  const types = (await h.owner.call("schema.types.list", {})).types as Array<{ key: string; template?: string; title?: string }>;
  const contactType = types.find((t) => t.key === "contact")?.key ?? types.find((t) => /contact/i.test(t.key))!.key;
  const t0 = Date.now();
  const staged = await h.owner.call("import.parse_csv", { text: csv(rows) });
  assert.equal((staged.tables as Array<{ rowCount: number }>)[0]!.rowCount, rows);
  const sug = await h.owner.call("import.suggest_mapping", { importId: staged.importId, type: contactType });
  const mapping = (sug.mapping as Array<{ column: string; field?: string }>).filter((m) => m.field).map((m) => ({ column: m.column, field: m.field! }));
  const preview = await h.owner.call("import.preview", { importId: staged.importId, type: contactType, mapping, match: mapping.some((m) => m.field === "email") ? ["email"] : undefined });
  const started = await h.owner.call("import.commit", { importId: staged.importId, previewToken: preview.previewToken, idempotencyKey: key });
  await waitFor(async () => ((await h.owner.call("import.get", { importId: staged.importId })).import as { state: string }).state === "done" ? true : null, 600_000, "import done");
  return { ms: Date.now() - t0, preview, runId: String(started.runId), contactType, fieldKeys: mapping.map((m) => m.field) };
}

test("200 contacts import with no AI account and a member sees them", async () => {
  const r = await run(200, "imp-200");
  console.log("IMPORT 200 rows", r.ms, "ms", JSON.stringify({ creates: r.preview["creates"], updates: r.preview["updates"], skips: r.preview["skips"], fields: r.fieldKeys }));
  assert.equal(r.preview["creates"], 200);
  aina = h.person("Aina", "aina", "aina@firm.test", "aina horse battery staple 9");
  await join(h, aina, await invite(h, aina.email), { device: "web" });
  const mine = await aina.call("records.query", { type: r.contactType, limit: 500 });
  const total = (mine.total as number | undefined) ?? (mine.rows as unknown[]).length;
  assert.equal(total, 200);
});

test("2,000 contacts (IMPORT_ROWS=20000 for the big one): timed", async () => {
  const r = await run(Number(process.env["IMPORT_ROWS"] ?? 2000), "imp-big");
  console.log("IMPORT big rows", r.ms, "ms", JSON.stringify({ creates: r.preview["creates"], skips: r.preview["skips"], errorCount: r.preview["errorCount"] }));
});
