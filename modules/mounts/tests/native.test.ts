// @reads /modules/mounts/handlers/native.ts
// Mounted files at their provider (live folders L3): where a mounted file opens, and an agent editing a Google Doc, a Google Sheet or an Excel workbook in place. A fake Google, Graph and Dropbox sit
// behind the provider capabilities; every call made to them is checked against that capability's frozen input in the manifests, so a wrapper cannot drift from the capability it calls.
import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { registry } from "../../../generated/registry.ts";
import dropboxManifest from "../../../manifests/dropbox.ts";
import googleManifest from "../../../manifests/google.ts";
import microsoftManifest from "../../../manifests/microsoft.ts";
import mountsManifest from "../../../manifests/mounts.ts";
import { handlers } from "../impl.ts";
import { TRACE, harness } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";

type Row = Record<string, unknown>;

const FILES: Record<string, { mime?: string; name?: string }> = {
  g_doc: { mime: "application/vnd.google-apps.document" }, g_sheet: { mime: "application/vnd.google-apps.spreadsheet" }, g_slides: { mime: "application/vnd.google-apps.presentation" }, g_pdf: { mime: "application/pdf" },
  m_xlsx: { name: "Budget.xlsx" }, m_docx: { name: "Letter.docx" }, m_pptx: { name: "Deck.pptx" }, m_txt: { name: "notes.txt" },
};

interface Seen { cap: string; input: Row }

/** Put fake providers behind the provider capabilities, checking each input against its manifest. */
function providers(w: World): { seen: Seen[]; refuse: Map<string, VyreErr> } {
  const seen: Seen[] = [];
  const refuse = new Map<string, VyreErr>();
  const inner = w.ctx.call.bind(w.ctx);
  const defs = [...(googleManifest.capabilities ?? []), ...(microsoftManifest.capabilities ?? []), ...(dropboxManifest.capabilities ?? [])];
  (w.ctx as { call: Ctx["call"] }).call = (async (cap: string, input: unknown) => {
    if (!/^(google|ms|dropbox)\./.test(cap)) return inner(cap as never, input as never);
    const i = (input ?? {}) as Row;
    const def = defs.find((d) => d.name === cap);
    assert.ok(def, `${cap} is in a manifest`);
    const misfit = validate(def.input, i, "", registry.$defs);
    assert.deepEqual(misfit, [], `${cap} was called with input its contract refuses`);
    seen.push({ cap, input: i });
    const failing = refuse.get(cap);
    if (failing) throw failing;
    switch (cap) {
      case "google.drive.get_file": return { file: { id: i["fileId"], name: "x", mimeType: FILES[String(i["fileId"])]?.mime ?? "application/pdf", webViewLink: `https://drive.google.com/file/d/${String(i["fileId"])}/view` } };
      case "ms.drive.get_item": return { item: { id: i["itemId"], name: FILES[String(i["itemId"])]?.name ?? "x", webUrl: `https://vyre.sharepoint.com/${String(i["itemId"])}` } };
      case "dropbox.files.get_metadata": return { entry: { id: i["path"], name: "Report.docx", path: "/Sales/Report.docx", pathLower: "/sales/report.docx", isFolder: false, webUrl: "https://www.dropbox.com/home/Sales?preview=Report.docx" } };
      case "google.docs.replace_text": return { replaced: 2 };
      case "google.docs.insert_text": return { inserted: true, index: 5 };
      case "google.sheets.get_values": return { values: [["a", "b"]] };
      case "google.sheets.update_values": return { updatedCells: (i["values"] as unknown[][]).reduce((n, r) => n + r.length, 0) };
      case "google.sheets.append_values": return { updatedRows: (i["values"] as unknown[]).length };
      case "ms.workbook.get_range": return { address: "Sheet1!A1:B1", values: [["a", 2]] };
      case "ms.workbook.update_range": return { address: "Sheet1!A1", updatedCells: 2 };
      case "ms.workbook.append_rows": return { address: "Sheet1!A9", updatedRows: 1 };
      default: throw new Error(`unscripted ${cap}`);
    }
  }) as Ctx["call"];
  return { seen, refuse };
}

let seq = 0;
/** A mount and one mounted file, as the engine would have left them. */
function seed(w: World, m: { kind: string; connectionId?: string; ref?: string; account?: string; pullOnly?: boolean }, remoteId: string): string {
  const id = `mnt_n${++seq}`, fileId = `fil_n${seq}`;
  w.db.run(
    `INSERT INTO mounts_mount (id, folder_id, kind, connection_id, ref, name, mode, review_changes, pull_only, state, owner, account, conflicts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, `fld_n${seq}`, m.kind, m.connectionId ?? null, m.ref ?? null, "Mounted", "server_copy", 1, m.pullOnly ? 1 : 0, "idle", "usr_owner", m.account ?? null, 0, 1, 1,
  );
  w.db.run(`INSERT INTO mounts_item (mount_id, item_key, remote_id, file_id, name, is_folder, native, dirty, deleted, conflict) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, `k${seq}`, remoteId, fileId, `File ${seq}`, 0, m.kind === "google_drive" ? 1 : 0, 0, 0, 0);
  return fileId;
}

const call = (w: World, cap: keyof typeof handlers, input: Row): Promise<Row> => (handlers[cap] as (c: Ctx, i: unknown) => Promise<Row>)(w.ctx, input);
const code = async (p: Promise<unknown>): Promise<string> => { try { await p; } catch (e) { return e instanceof VyreErr ? e.error.code : String(e); } return "none"; };
const GOOGLE = { kind: "google_drive", connectionId: "con_g", ref: "root" } as const;
const GRAPH = { kind: "sharepoint", connectionId: "con_m", ref: "drv1" } as const;

test("file_link says where each kind of mounted file opens, and what an agent can do to it", async () => {
  const w = harness();
  const { seen } = providers(w);
  const link = async (fileId: string): Promise<Row> => obj((await call(w, "mounts.file_link", { fileId }))["link"]);
  const obj = (v: unknown): Row => (v ?? {}) as Row;
  const doc = await link(seed(w, GOOGLE, "g_doc"));
  assert.deepEqual(doc, { mountId: doc["mountId"], kind: "google_drive", type: "google_doc", openIn: "Google Docs", webUrl: "https://docs.google.com/document/d/g_doc/edit", edit: ["replace_text", "insert_text"] });
  assert.equal((await link(seed(w, GOOGLE, "g_sheet")))["webUrl"], "https://docs.google.com/spreadsheets/d/g_sheet/edit");
  assert.deepEqual([(await link(seed(w, GOOGLE, "g_slides")))["openIn"], (await link(seed(w, GOOGLE, "g_slides")))["edit"]], ["Google Slides", []]);
  const pdf = await link(seed(w, GOOGLE, "g_pdf"));
  assert.deepEqual([pdf["openIn"], pdf["webUrl"]], ["Google Drive", "https://drive.google.com/file/d/g_pdf/view"], "any other Drive file opens in Drive");
  const xl = await link(seed(w, GRAPH, "m_xlsx"));
  assert.deepEqual([xl["type"], xl["openIn"], xl["webUrl"], xl["edit"]], ["excel", "Excel", "https://vyre.sharepoint.com/m_xlsx", ["read_cells", "write_cells", "append_rows"]]);
  assert.deepEqual([(await link(seed(w, GRAPH, "m_docx")))["openIn"], (await link(seed(w, GRAPH, "m_pptx")))["openIn"], (await link(seed(w, GRAPH, "m_txt")))["openIn"]], ["Word", "PowerPoint", "SharePoint"]);
  assert.equal((await link(seed(w, { kind: "onedrive", connectionId: "con_m" }, "m_txt")))["openIn"], "OneDrive");
  const dbx = await link(seed(w, { kind: "dropbox", connectionId: "con_d", ref: "id:sales" }, "id:file1"));
  assert.deepEqual([dbx["type"], dbx["openIn"], dbx["webUrl"], dbx["edit"]], ["dropbox_file", "Dropbox", "https://www.dropbox.com/home/Sales?preview=Report.docx", []]);
  assert.deepEqual(seen.find((s) => s.cap === "ms.drive.get_item")?.input, { connectionId: "con_m", driveId: "drv1", itemId: "m_xlsx" }, "a library is addressed by its drive");
  // the link is a read of the mounted file: it has the manifest's output shape
  const out = await call(w, "mounts.file_link", { fileId: seed(w, GOOGLE, "g_doc") });
  assert.deepEqual(validate((mountsManifest.capabilities?.find((c) => c.name === "mounts.file_link") as NonNullable<typeof mountsManifest.capabilities>[number]).output, out, "", registry.$defs), []);
});

test("a file that is not from a cloud folder, or that the asker cannot open at the provider, has no link and says why; other failures are loud", async () => {
  const w = harness();
  const { refuse } = providers(w);
  const own = await call(w, "mounts.file_link", { fileId: "fil_unmounted" });
  assert.equal(own["link"], undefined);
  assert.match(String(own["reason"]), /does not come from a connected folder/);
  const local = seed(w, { kind: "local" }, "x");
  assert.equal((await call(w, "mounts.file_link", { fileId: local }))["link"], undefined, "a folder on a computer has no provider");
  const f = seed(w, GOOGLE, "g_doc");
  for (const c of ["permission.no_grant", "validation.not_found", "provider.auth_failed", "validation.precondition_failed"]) {
    refuse.set("google.drive.get_file", new VyreErr({ code: c as never, message: `refused ${c}`, retryable: false, traceId: TRACE, next: [] }));
    const r = await call(w, "mounts.file_link", { fileId: f });
    assert.deepEqual([r["link"], typeof r["reason"]], [undefined, "string"], c);
  }
  refuse.set("google.drive.get_file", new VyreErr({ code: "internal.unexpected" as never, message: "boom", retryable: false, traceId: TRACE, next: [] }));
  assert.equal(await code(call(w, "mounts.file_link", { fileId: f })), "internal.unexpected");
  assert.equal(await code(call(w, "mounts.file_link", {})), "validation.bad_input");
});

test("doc_replace_text and doc_insert_text edit the Google Doc itself, as the asker, and carry the idempotency key", async () => {
  const w = harness();
  const { seen } = providers(w);
  const f = seed(w, GOOGLE, "g_doc");
  assert.deepEqual(await call(w, "mounts.doc_replace_text", { fileId: f, find: "Client", replace: "Dana", matchCase: true, idempotencyKey: "k1" }), { replaced: 2 });
  assert.deepEqual(seen.at(-1), { cap: "google.docs.replace_text", input: { connectionId: "con_g", documentId: "g_doc", find: "Client", replace: "Dana", matchCase: true, idempotencyKey: "k1" } });
  assert.deepEqual(await call(w, "mounts.doc_insert_text", { fileId: f, text: " (net 30)", anchor: "Total", idempotencyKey: "k2" }), { inserted: true });
  assert.deepEqual(seen.at(-1)?.input, { connectionId: "con_g", documentId: "g_doc", text: " (net 30)", anchor: "Total", idempotencyKey: "k2" });
  assert.equal(seen.some((s) => "as" in s.input), false, "no impersonation: the asker's own Google account");
});

test("sheet_read, sheet_write and sheet_append work on a Google Sheet (A1 with the sheet quoted) and on an Excel workbook (sheet and range apart)", async () => {
  const w = harness();
  const { seen } = providers(w);
  const gs = seed(w, GOOGLE, "g_sheet");
  assert.deepEqual(await call(w, "mounts.sheet_read", { fileId: gs, range: "A1:B2" }), { values: [["a", "b"]] });
  assert.equal(seen.at(-1)?.input["range"], "A1:B2");
  await call(w, "mounts.sheet_read", { fileId: gs, sheet: "Q4 Leads", range: "A1:B2" });
  assert.equal(seen.at(-1)?.input["range"], "'Q4 Leads'!A1:B2");
  await call(w, "mounts.sheet_read", { fileId: gs, sheet: "O'Brien", range: "A1" });
  assert.equal(seen.at(-1)?.input["range"], "'O''Brien'!A1");
  assert.deepEqual(await call(w, "mounts.sheet_write", { fileId: gs, sheet: "Leads", range: "B2", values: [["x", 1, true, null]], idempotencyKey: "k3" }), { updatedCells: 4 });
  assert.deepEqual(seen.at(-1)?.input, { connectionId: "con_g", spreadsheetId: "g_sheet", range: "Leads!B2", values: [["x", "1", "true", ""]], valueInputOption: "USER_ENTERED", idempotencyKey: "k3" });
  assert.deepEqual(await call(w, "mounts.sheet_append", { fileId: gs, values: [["a"], ["b"]], idempotencyKey: "k4" }), { updatedRows: 2 });
  assert.deepEqual(seen.at(-1)?.input, { connectionId: "con_g", spreadsheetId: "g_sheet", range: "A1", values: [["a"], ["b"]], idempotencyKey: "k4" });

  const xl = seed(w, GRAPH, "m_xlsx");
  assert.deepEqual(await call(w, "mounts.sheet_read", { fileId: xl, sheet: "Sheet1", range: "A1:B1" }), { values: [["a", 2]] });
  assert.deepEqual(seen.at(-1), { cap: "ms.workbook.get_range", input: { connectionId: "con_m", driveId: "drv1", itemId: "m_xlsx", sheet: "Sheet1", range: "A1:B1" } });
  assert.deepEqual(await call(w, "mounts.sheet_write", { fileId: xl, sheet: "Sheet1", range: "A1", values: [["a", 2]], idempotencyKey: "k5" }), { updatedCells: 2 });
  assert.deepEqual(seen.at(-1)?.input, { connectionId: "con_m", driveId: "drv1", itemId: "m_xlsx", sheet: "Sheet1", range: "A1", values: [["a", 2]], idempotencyKey: "k5" });
  assert.deepEqual(await call(w, "mounts.sheet_append", { fileId: xl, sheet: "Sheet1", values: [["r", 1]], idempotencyKey: "k6" }), { updatedRows: 1 });
  assert.equal(await code(call(w, "mounts.sheet_read", { fileId: xl, range: "A1" })), "validation.bad_input", "an Excel workbook needs the worksheet name");
  assert.equal(await code(call(w, "mounts.sheet_write", { fileId: gs, range: "A1", values: [] })), "validation.bad_input");
  assert.equal(await code(call(w, "mounts.sheet_write", { fileId: gs, range: "A1", values: [[]] })), "validation.bad_input");
  assert.equal(await code(call(w, "mounts.sheet_read", { fileId: gs, range: "" })), "validation.bad_input");
});

test("an edit that the file's kind cannot take says who edits it instead, and nothing is sent to the provider", async () => {
  const w = harness();
  const { seen } = providers(w);
  const before = (): number => seen.filter((s) => !s.cap.endsWith("get_file") && !s.cap.endsWith("get_item") && !s.cap.endsWith("get_metadata")).length;
  const word = seed(w, GRAPH, "m_docx");
  assert.equal(await code(call(w, "mounts.doc_replace_text", { fileId: word, find: "a", replace: "b" })), "validation.unsupported");
  try { await call(w, "mounts.doc_insert_text", { fileId: word, text: "x" }); } catch (e) { assert.match((e as VyreErr).error.message, /edits it in Word/); }
  assert.equal(await code(call(w, "mounts.sheet_write", { fileId: seed(w, GOOGLE, "g_doc"), range: "A1", values: [["x"]] })), "validation.unsupported", "a Doc is not a sheet");
  assert.equal(await code(call(w, "mounts.sheet_append", { fileId: seed(w, { kind: "dropbox", connectionId: "con_d", ref: "id:s" }, "id:f"), values: [["x"]] })), "validation.unsupported");
  assert.equal(await code(call(w, "mounts.doc_replace_text", { fileId: "fil_unmounted", find: "a", replace: "b" })), "validation.precondition_failed");
  assert.equal(await code(call(w, "mounts.sheet_write", { fileId: seed(w, { ...GOOGLE, pullOnly: true }, "g_sheet"), range: "A1", values: [["x"]] })), "validation.precondition_failed", "a read-only mount is not written to");
  assert.equal(await code(call(w, "mounts.sheet_read", { fileId: seed(w, { ...GOOGLE, pullOnly: true }, "g_sheet"), range: "A1" })), "none", "but it can be read");
  assert.equal(before(), 1, "only the allowed read reached the provider");
});

test("a provider that refuses the asker refuses the edit: the provider's permissions decide", async () => {
  const w = harness();
  const { refuse } = providers(w);
  const f = seed(w, GOOGLE, "g_doc");
  refuse.set("google.docs.replace_text", new VyreErr({ code: "permission.no_grant" as never, message: "Google would not let this account reach that.", retryable: false, traceId: TRACE, next: [] }));
  assert.equal(await code(call(w, "mounts.doc_replace_text", { fileId: f, find: "a", replace: "b", idempotencyKey: "k9" })), "permission.no_grant");
});

test("the native capabilities are in the mounts manifest: edits behind the post Gate and Edit on the file, reads on the files tools", () => {
  const caps = (mountsManifest.capabilities ?? []).filter((c) => /^mounts\.(file_link|doc_|sheet_)/.test(c.name));
  assert.deepEqual(caps.map((c) => c.name).sort(), ["mounts.doc_insert_text", "mounts.doc_replace_text", "mounts.file_link", "mounts.sheet_append", "mounts.sheet_read", "mounts.sheet_write"]);
  for (const c of caps) {
    assert.equal(c.surfaces.mcp?.toolset, "files", c.name);
    assert.deepEqual(c.resource, { type: "file", id: "/fileId" }, `${c.name} is bound to the Vyre file`);
    assert.ok(c.summary.length <= 300, c.name);
    if (c.effects === "outward") assert.deepEqual([c.gate?.act, c.level, c.audit], ["post", "edit", "always"], c.name);
    else assert.equal(c.level, "view");
  }
  assert.deepEqual(Object.keys(handlers).filter((n) => /^mounts\.(file_link|doc_|sheet_)/.test(n)).sort(), caps.map((c) => c.name).sort());
});
