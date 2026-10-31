// Open in the provider (live folders L3): a file from a connected folder opens in the app it lives in (Google Docs, Sheets or Slides, Word, Excel, PowerPoint, Dropbox) from its row menu and from the
// viewer. The words come from what the row knows, the address from the provider at the press. A file Vyre holds itself shows neither.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { isItem } from "../../../../../../ui/src/Menu/props.ts";
import type { MenuEntry, MenuItem } from "../../../../../../ui/src/Menu/props.ts";
import { fileLink, openInLabel, openInProvider, openInWords } from "../open-in.ts";
import { lineMenuEntries } from "../list/index.ts";
import { fileLine } from "../tree/index.ts";
import type { FileRow } from "../tree/index.ts";
import { FileViewer } from "../viewer/FileViewer.tsx";
import { FilesViewerDataProvider } from "../viewer/data.tsx";
import { createSampleViewer } from "../viewer/sample.ts";

installDom();

const row = (o: Partial<FileRow> & { fileId: string; name: string }): FileRow => ({
  folderId: "fld_1", kind: "other", mime: "application/octet-stream", size: 10, version: 1, label: 0, ownerId: "usr_1", createdAt: 1, updatedAt: 2, updatedBy: "usr_1", thumb: false, holds: 0, ...o,
}) as FileRow;
const from = (provider: string, o: Partial<FileRow> & { fileId: string; name: string }): FileRow => row({ ...o, source: { mountId: "mnt_1", provider } });
const items = (entries: readonly MenuEntry[]): MenuItem[] => entries.filter(isItem);

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

test("the words follow the provider and the file: Google natives by the export they are kept as, Office files by their extension, Dropbox files as Dropbox", () => {
  const label = (f: FileRow): string | null => openInLabel(fileLine(f));
  assert.equal(label(from("Google Drive", { fileId: "a", name: "Plan", kind: "google_native", mime: DOCX })), "Google Docs");
  assert.equal(label(from("Google Drive", { fileId: "b", name: "Budget", kind: "google_native", mime: XLSX })), "Google Sheets");
  assert.equal(label(from("Google Drive", { fileId: "c", name: "Pitch", kind: "google_native", mime: "application/pdf" })), "Google Slides");
  assert.equal(label(from("Google Drive", { fileId: "d", name: "scan.pdf", kind: "pdf", mime: "application/pdf" })), "Google Drive", "a plain Drive file");
  assert.equal(label(from("SharePoint", { fileId: "e", name: "Letter.DOCX" })), "Word");
  assert.equal(label(from("OneDrive", { fileId: "f", name: "Budget.xlsx" })), "Excel");
  assert.equal(label(from("SharePoint", { fileId: "g", name: "Deck.pptx" })), "PowerPoint");
  assert.equal(label(from("OneDrive", { fileId: "h", name: "notes.txt" })), "OneDrive");
  assert.equal(label(from("SharePoint", { fileId: "i", name: "notes.txt" })), "SharePoint");
  assert.equal(label(from("Dropbox", { fileId: "j", name: "Report.docx" })), "Dropbox");
  assert.equal(label(from("GitHub", { fileId: "k", name: "README.md" })), null, "a repository has no editor to open");
  assert.equal(label(from("This computer", { fileId: "l", name: "a.txt" })), null);
  assert.equal(label(row({ fileId: "m", name: "mine.docx" })), null, "a file Vyre holds itself");
  assert.equal(openInWords("Google Docs"), "Open in Google Docs");
});

test("the row menu offers Open in … for a mounted file, once a handler is there, and not for a folder or a plain file", () => {
  const h = { open: () => undefined, quickLook: () => undefined, share: () => undefined, rename: () => undefined, trash: () => undefined, restore: () => undefined };
  const did: string[] = [];
  const withOpenIn = { ...h, openIn: (l: { id: string }) => void did.push(l.id) };
  const mounted = fileLine(from("Dropbox", { fileId: "fil_dbx", name: "Report.docx" }));
  const entries = items(lineMenuEntries([mounted], false, withOpenIn));
  assert.deepEqual(entries.map((e) => e.label), ["Open", "Quick Look", "Open in Dropbox", "Rename…", "Move to Trash"]);
  entries.find((e) => e.label === "Open in Dropbox")?.onSelect?.();
  assert.deepEqual(did, ["fil_dbx"]);
  assert.ok(!items(lineMenuEntries([mounted], false, h)).some((e) => e.label.startsWith("Open in")), "no way to open a link, no entry");
  assert.ok(!items(lineMenuEntries([fileLine(row({ fileId: "fil_p", name: "Report.docx" }))], false, withOpenIn)).some((e) => e.label.startsWith("Open in")));
  assert.ok(!items(lineMenuEntries([mounted, fileLine(from("Dropbox", { fileId: "fil_2", name: "b.docx" }))], false, withOpenIn)).some((e) => e.label.startsWith("Open in")), "several selected: no single place to open");
  assert.ok(!items(lineMenuEntries([mounted], true, withOpenIn)).some((e) => e.label.startsWith("Open in")), "not from the Trash");
});

test("pressing it asks the provider for the address at that moment and opens it; no address, nothing opens and the caller hears", async () => {
  const asked: unknown[] = [];
  const opened: string[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    asked.push([cap, input]);
    return { link: { openIn: "Google Docs", webUrl: "https://docs.google.com/document/d/g1/edit", type: "google_doc", edit: [] } };
  };
  assert.equal(await openInProvider(call, (u) => void opened.push(u), "fil_1"), true);
  assert.deepEqual([asked, opened], [[["mounts.file_link", { fileId: "fil_1" }]], ["https://docs.google.com/document/d/g1/edit"]]);
  const none = async (): Promise<unknown> => ({ reason: "Google would not let this account reach that." });
  assert.equal(await openInProvider(none, (u) => void opened.push(u), "fil_1"), false);
  assert.equal(opened.length, 1);
  const broken = async (): Promise<unknown> => { throw new Error("offline"); };
  assert.equal(await fileLink(broken, "fil_1"), null);
  assert.equal(await openInProvider(broken, (u) => void opened.push(u), "fil_1"), false);
});

test("the viewer of a mounted file shows an Open in button once the provider gave an address, and the button opens it", async () => {
  const s = createSampleViewer();
  const opened: string[] = [];
  const row0 = s.rows.get("f_note")!;
  row0.data = { ...row0.data, file: { ...row0.data.file, source: { mountId: "mnt_1", provider: "Google Drive" } } };
  const inner = s.data.call;
  const data = {
    ...s.data, openUrl: (u: string) => void opened.push(u),
    call: async (cap: string, input: unknown): Promise<unknown> => (cap === "mounts.file_link" ? { link: { openIn: "Google Docs", webUrl: "https://docs.google.com/document/d/n1/edit", type: "google_doc", edit: ["replace_text"] } } : inner(cap, input)),
  };
  const root = await mount(createRoot, <FilesViewerDataProvider value={data}><FileViewer fileId="f_note" /></FilesViewerDataProvider>);
  await flush();
  const btn = find(root, "vw-open-in");
  assert.ok(btn, "the button is in the header");
  assert.equal(textOf(btn).trim(), "Open in Google Docs");
  await press(btn!);
  assert.deepEqual(opened, ["https://docs.google.com/document/d/n1/edit"]);
});

test("a file Vyre holds itself, a mounted file with no address for this person, and a shell with no way to open links show no button", async () => {
  const plain = createSampleViewer();
  const calls: string[] = [];
  const watch = { ...plain.data, openUrl: () => undefined, call: async (cap: string, input: unknown): Promise<unknown> => { calls.push(cap); return plain.data.call(cap, input); } };
  const a = await mount(createRoot, <FilesViewerDataProvider value={watch}><FileViewer fileId="f_note" /></FilesViewerDataProvider>);
  await flush();
  assert.equal(find(a, "vw-open-in"), null);
  assert.equal(calls.includes("mounts.file_link"), false, "nothing is asked for a file that is not mounted");

  const s = createSampleViewer();
  const r = s.rows.get("f_note")!;
  r.data = { ...r.data, file: { ...r.data.file, source: { mountId: "mnt_1", provider: "Dropbox" } } };
  const inner = s.data.call;
  const denied = { ...s.data, openUrl: () => undefined, call: async (cap: string, input: unknown): Promise<unknown> => (cap === "mounts.file_link" ? { reason: "no" } : inner(cap, input)) };
  const b = await mount(createRoot, <FilesViewerDataProvider value={denied}><FileViewer fileId="f_note" /></FilesViewerDataProvider>);
  await flush();
  assert.equal(find(b, "vw-open-in"), null);

  const noOpen = { ...s.data, call: async (cap: string, input: unknown): Promise<unknown> => (cap === "mounts.file_link" ? { link: { openIn: "Dropbox", webUrl: "https://www.dropbox.com/home", type: "dropbox_file", edit: [] } } : inner(cap, input)) };
  const c = await mount(createRoot, <FilesViewerDataProvider value={noOpen}><FileViewer fileId="f_note" /></FilesViewerDataProvider>);
  await flush();
  assert.equal(find(c, "vw-open-in"), null, "no openUrl, no button that does nothing");
});
