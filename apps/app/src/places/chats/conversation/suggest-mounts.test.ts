// The # picker and mounted folders (rc.8 mounts): a mounted folder lists first with its provider logo and how it is doing, a file under a mount says where it comes from, and a failed read leaves the plain lists.
import test from "node:test";
import assert from "node:assert/strict";
import { NONE, fetchSuggestions, mountNote, withMounts } from "./suggest.ts";
import type { Suggested } from "./suggest.ts";

const NOW = 10 * 3_600_000;
const mount = (o: Record<string, unknown>) => ({ mountId: "mnt_1", folderId: "fld_1", kind: "google_drive" as const, provider: "Google Drive", name: "Sales", state: "idle" as const, mode: "server_copy" as const, reviewChanges: true, pendingChanges: 0, conflicts: 0, lastSyncAt: NOW - 5 * 60_000, ...o });
const hit = (id: string, path: string) => ({ kind: "file" as const, id, title: "Deck.pdf", path, score: 1 }) as never;

test("a mounted folder says where it comes from and when it synced", () => {
  assert.equal(mountNote(mount({}), NOW), "Google Drive · Synced 5 min ago");
  assert.equal(mountNote(mount({ state: "failing" }), NOW), "Google Drive · Needs attention");
  assert.equal(mountNote(mount({ lastSyncAt: undefined }), NOW), "Google Drive · Not synced yet");
});

test("mounted folders lead the Folders group with their brand; a file under a mount names the mount", () => {
  const base: Suggested = { ...NONE, files: [{ t: "Deck.pdf", s: "Personal/Sales/Deck.pdf", kind: "File", ref: "fil_1" }], folders: [{ t: "Sales", s: "Personal/Sales", kind: "Folder", ref: "fld_1" }, { t: "Other", kind: "Folder", ref: "fld_2" }] };
  const out = withMounts(base, [hit("fil_1", "Personal/Sales/Deck.pdf")], [mount({}), mount({ mountId: "mnt_2", folderId: "fld_9", kind: "onedrive", provider: "OneDrive", name: "Docs" })], "", NOW);
  const folders = out.folders as Array<{ t: string; ref?: string; data?: Record<string, string> }>;
  assert.deepEqual(folders.map((f) => f.ref), ["fld_1", "fld_9", "fld_2"], "mounts first, the same folder once");
  assert.equal(folders[0]?.data?.["brand"], "gdrive");
  assert.equal(folders[1]?.data?.["brand"], "onedrive");
  const file = out.files[0] as { s?: string; data?: Record<string, string> };
  assert.equal(file.s, "Google Drive · Sales");
  assert.equal(file.data?.["brand"], "gdrive");
});

test("a typed word narrows the mounted folders; a computer folder has no brand", () => {
  const out = withMounts(NONE, [], [mount({}), mount({ mountId: "mnt_3", folderId: "fld_3", kind: "local", provider: "Local folder", name: "Site" })], "sit", NOW);
  const folders = out.folders as Array<{ t: string; data?: Record<string, string> }>;
  assert.deepEqual(folders.map((f) => f.t), ["Site"]);
  assert.equal(folders[0]?.data?.["brand"], undefined);
});

test("fetchSuggestions keeps the plain lists when mounts cannot be read", async () => {
  const call = async (cap: string): Promise<unknown> => {
    if (cap === "mounts.list") throw new Error("down");
    if (cap === "projects.list") return { projects: [] };
    if (cap === "files.folder.search") return { folders: [{ folderId: "fld_2", name: "Other", path: "Personal/Other" }] };
    return { hits: [] };
  };
  const out = await fetchSuggestions({ call } as never, "#", "");
  assert.deepEqual((out.folders as Array<{ ref?: string }>).map((f) => f.ref), ["fld_2"]);
});

test("the preview of a mounted folder says its source, state and last sync; a file's preview says where it comes from", async () => {
  const { previewOf } = await import("./suggest.ts");
  const call = async (cap: string): Promise<unknown> => {
    if (cap === "mounts.list") return { mounts: [mount({ lastSyncAt: NOW, state: "failing" })] };
    return { file: { size: 2400, updatedAt: NOW, updatedBy: "usr_1", source: { mountId: "mnt_1", provider: "Google Drive" } } };
  };
  const data = { call, nameOf: () => "Omar" } as never;
  const folder = await previewOf(data, { group: "Folders", label: "Sales", kind: "Folder", ref: "fld_1", data: { mount: "mnt_1" } });
  assert.equal(folder?.sub, "Google Drive");
  assert.deepEqual(folder?.fields[0], ["State", "Needs attention"]);
  const file = await previewOf(data, { group: "Files", label: "Deck.pdf", kind: "File", ref: "fil_1" });
  assert.deepEqual(file?.fields[0], ["From", "Google Drive"]);
});
