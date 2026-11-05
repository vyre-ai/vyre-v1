// Console > Data > Export: Export everything (spaces.export, progress, download), what is included and never included, and Records only (records.export).
import test from "node:test";
import assert from "node:assert/strict";
import { ExportPage, INCLUDED, NEVER } from "../pages/ExportPage.tsx";
import { createRoot } from "test-renderer";
import { mountPage } from "./page-kit.tsx";

const SPACE = (owner: string) => ({ space: { id: "spc_1", name: "Northwind", kind: "team", owner, fingerprint: "ab", address: { mode: "relay" }, defaults: {}, createdAt: 1 } });
const TYPES = { types: [{ key: "matter", title: "Matter", plural: "Matters", icon: "doc", label: "internal", system: false, titleField: "name", fields: [] }, { key: "contact", title: "Contact", plural: "Contacts", icon: "doc", label: "internal", system: false, titleField: "name", fields: [] }] };
const READY = { runId: "run_1", state: "ready", fileId: "fil_1", name: "northwind-export.zip", sizeBytes: 3, expiresAt: Date.now() + 86_400_000 };
const FILE = { file: { name: "northwind-export.zip", size: 3 } };
const BYTES = { base64: "YWJj", mime: "application/zip", size: 3, truncated: false };
const ME = { me: { id: "usr_sample", name: "Me", role: "" } };

test("the page lists what the export holds and what it never holds, in plain words", async () => {
  const p = await mountPage(createRoot, <ExportPage />, { "spaces.get": SPACE("usr_sample"), "schema.describe": TYPES }, undefined, ME);
  try {
    const t = p.text();
    for (const [, title] of INCLUDED) assert.ok(t.includes(title), title);
    for (const [, title] of NEVER) assert.ok(t.includes(title), title);
    assert.ok(t.includes("2 record types") && t.includes("Never included") && t.includes("Left out"));
    assert.doesNotMatch(t, /!|successfully|suppression|sandbox/i);
  } finally { p.restore(); }
});

test("Export everything calls spaces.export, shows the Space is being packed, then the finished file with a Done button", async () => {
  let ready = false;
  const p = await mountPage(createRoot, <ExportPage />, { "spaces.get": SPACE("usr_sample"), "schema.describe": TYPES }, (cap) => {
    if (cap === "spaces.export") return { runId: "run_1" };
    if (cap === "backup.export_status") { if (!ready) throw new Error("not yet"); return READY; }
    if (cap === "files.get") return FILE;
    if (cap === "files.read") return BYTES;
    return { ok: true };
  }, ME);
  try {
    await p.press("export-all-start");
    assert.equal(p.called("spaces.export").length, 1);
    assert.ok(p.text().includes("Packing the Space"), "progress while the file is not ready");
    assert.ok(p.find("export-all-start")?.props["disabled"] === true || p.find("export-all-start")?.props["aria-disabled"] === true, "one export at a time");
    ready = true;
    await new Promise((r) => setTimeout(r, 3300));
    const { flush } = await import("../../../../../ui/src/testing/dom.ts");
    await flush();
    assert.deepEqual(p.called("backup.export_status").at(-1)!.input, { runId: "run_1" });
    assert.ok(p.text().includes("Ready: northwind-export.zip"));
    assert.deepEqual(p.called("files.get").at(-1)!.input, { fileId: "fil_1" });
    await p.press("export-done");
    assert.ok(p.has("export-all-start"), "Done returns the row to its first state");
  } finally { p.restore(); }
});

test("when the file is ready at once the row shows it without waiting", async () => {
  const p = await mountPage(createRoot, <ExportPage />, { "spaces.get": SPACE("usr_sample"), "schema.describe": TYPES }, (cap) => cap === "spaces.export" ? { runId: "run_1" } : cap === "backup.export_status" ? READY : cap === "files.get" ? FILE : cap === "files.read" ? BYTES : { ok: true }, ME);
  try {
    await p.press("export-all-start");
    assert.ok(p.text().includes("Ready: northwind-export.zip"));
  } finally { p.restore(); }
});

test("only the Owner can export everything", async () => {
  const p = await mountPage(createRoot, <ExportPage />, { "spaces.get": SPACE("usr_other"), "schema.describe": TYPES }, undefined, ME);
  try {
    assert.ok(!p.has("export-all-start") && p.text().includes("Owners only"));
  } finally { p.restore(); }
});

test("Records only exports one record type as a spreadsheet through records.export", async () => {
  const p = await mountPage(createRoot, <ExportPage />, { "spaces.get": SPACE("usr_sample"), "schema.describe": TYPES }, (cap) => cap === "records.export" ? { fileId: "fil_2" } : cap === "files.get" ? { file: { name: "matters.csv", size: 3 } } : cap === "files.read" ? BYTES : { ok: true }, ME);
  try {
    assert.ok(!p.has("export-records-form"));
    await p.press("export-records-open");
    assert.ok(p.has("export-records-form"));
    await p.press("export-records-go");
    assert.deepEqual(p.called("records.export").at(-1)!.input, { type: "matter", format: "csv" });
    assert.deepEqual(p.called("files.get").at(-1)!.input, { fileId: "fil_2" });
    assert.ok(p.text().includes("The export is ready."));
  } finally { p.restore(); }
});

test("a save still going after the server's wait is not a bare error: the page says so and goes on", async () => {
  const { saveInProgress } = await import("../pages/SpaceExport.tsx");
  assert.equal(saveInProgress("A shared Space write is still in progress. Retry after it finishes."), true);
  assert.equal(saveInProgress("Shared Space data changed during collection. Retry the snapshot."), true);
  assert.equal(saveInProgress("Only the owner can export."), false);
});
