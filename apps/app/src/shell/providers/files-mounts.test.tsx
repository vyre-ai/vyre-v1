// Files > Mounts in the shell (spec 2.16 Mounts, 3.5): Connect a folder is in the folder menu, the New menu and the sidebar; the mount sheet is given the Space's connections, this computer and its
// folders; a mounted folder's status line says where it comes from, how it is doing and what waits, and its buttons are one capability call each.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { createSampleFiles } from "../../places/files/list/sample.ts";
import { newMenuEntries } from "../../places/files/list/FilesList.tsx";
import { folderMenu } from "../../../../../ui/src/FolderTree/index.tsx";
import { loadAccounts, mountLine, peopleOf, thisDevice } from "./files-mounts-data.ts";
import { MountStrip } from "./files-mounts.tsx";
import { filesData } from "./files-data.ts";
import { sampleRuntime } from "./misc-test-runtime.tsx";
import type { MountRow } from "../../places/files/mounts/index.ts";

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const row = (o: Partial<MountRow> = {}): MountRow => ({ mountId: "mnt_1", folderId: "fld_1", kind: "github", provider: "GitHub", ref: "acme/site", name: "site", state: "idle", mode: "server_copy", reviewChanges: true, pendingChanges: 0, conflicts: 0, lastSyncAt: NOW - 3 * 60_000, ...o });
const labels = (e: ReadonlyArray<{ label?: string }>): string[] => e.map((x) => x.label ?? "-");

test("Connect a folder is in the folder menu (for a folder you can manage), the New menu and the sidebar, and only where the shell can open the sheet", () => {
  const node = { id: "fld_1", name: "Clients", parentId: null, count: 0, scope: "space", section: "space", via: "space", open: false } as never;
  assert.ok(labels(folderMenu(node, false, false, { onMount: () => undefined })).includes("Connect a Folder…"));
  assert.ok(!labels(folderMenu(node, false, false, {})).includes("Connect a Folder…"), "without a handler the entry is not offered");
  const shared = { ...(node as object), via: "shared", scope: "personal" } as never;
  assert.ok(!labels(folderMenu(shared, false, false, { onMount: () => undefined })).includes("Connect a Folder…"), "a folder you cannot manage takes no mount");
  assert.deepEqual(labels(newMenuEntries({ newFolder: () => undefined, connect: () => undefined })), ["New Folder", "Connect a Folder…"]);
  const rt = sampleRuntime({ screens: createSampleFiles().data.screens, call: async () => ({}) });
  const opened: Array<string | null> = [];
  const d = filesData(rt, undefined, { connect: (into) => void opened.push(into) });
  d.nav.connectFolder?.("fld_1");
  d.nav.connectFolder?.(null);
  assert.deepEqual(opened, ["fld_1", null]);
  assert.equal(filesData(rt).nav.connectFolder, undefined);
});

test("accounts: Google and Microsoft come from the Space's active connections, GitHub from the App's installation, this computer from the device; nothing connected says so", async () => {
  const call = async (cap: string): Promise<unknown> => {
    if (cap === "connections.list") return { connections: [
      { connectionId: "con_g", connector: "google", title: "firm@example.com", state: "active" },
      { connectionId: "con_m", connector: "microsoft", title: "firm@contoso.com", state: "needs_reconnect" },
    ] };
    if (cap === "github.health") return { state: "healthy", latencyMs: 40 };
    if (cap === "github.installations.list") return { installations: [{ id: 1, account: "acme" }] };
    throw new Error(cap);
  };
  const a = await loadAccounts(call, { id: "dev_1", name: "Irfad's MacBook" });
  assert.deepEqual(a.google_drive, { label: "firm@example.com", connected: true, connectionId: "con_g" });
  assert.equal(a.microsoft.connected, false, "a connection that needs reconnecting is not connected");
  assert.deepEqual(a.local, { label: "Irfad's MacBook", connected: true, deviceId: "dev_1" });
  assert.deepEqual(a.github, { label: "acme", connected: true });
  const none = await loadAccounts(async () => { throw new Error("no"); }, null);
  assert.deepEqual(Object.values(none).map((x) => x.connected), [false, false, false, false]);
});

test("this computer is the device the person is on; a revoked or absent one is not offered", async () => {
  assert.deepEqual(await thisDevice(async () => ({ devices: [{ id: "dev_a", name: "Old", current: false }, { id: "dev_b", name: "Mac", current: true }] })), { id: "dev_b", name: "Mac" });
  assert.equal(await thisDevice(async () => ({ devices: [{ id: "dev_b", name: "Mac", current: true, revokedAt: 5 }] })), null);
  assert.deepEqual(peopleOf([{ id: "usr_me", name: "Me", kind: "person" }, { id: "usr_a", name: "Ana", kind: "person" }, { id: "agt_x", name: "Bot", kind: "agent" }], "usr_me"), [{ id: "usr_a", name: "Ana" }]);
});

test("a mounted folder's status line: source, state, last sync, what waits", () => {
  const ok = mountLine(row({ pendingChanges: 2, conflicts: 1 }), NOW);
  assert.deepEqual([ok.source, ok.state, ok.canSync], ["GitHub acme/site", "Needs a look", true]);
  assert.equal(ok.detail, "Synced 3 min ago · 2 changes waiting · 1 conflict");
  assert.equal(mountLine(row({ state: "paused" }), NOW).state, "Paused");
  assert.equal(mountLine(row({ state: "paused" }), NOW).canSync, false);
  const bad = mountLine(row({ state: "failing", error: "GitHub says the token expired" }), NOW);
  assert.deepEqual([bad.state, bad.tone, bad.detail], ["Needs attention", "bad", "GitHub says the token expired"]);
  const local = mountLine(row({ kind: "local", provider: "Local folder", ref: undefined, fromDevice: "Irfad's MacBook", state: "device_offline", lastSyncAt: undefined }), NOW);
  assert.equal(local.source, "Folder on Irfad's MacBook");
  assert.equal(local.canSync, false, "a computer's folder syncs when the computer reports");
  assert.match(local.detail, /syncs when it is on\. Not synced yet/);
  assert.equal(mountLine(row({ kind: "google_drive", provider: "Google Drive", ref: "drv_1", name: "Firm Drive" }), NOW).source, "Google Drive Firm Drive");
});

test("the status line draws its source, its words and its buttons: Pause or Resume by state, and no Sync now for a computer's folder", () => {
  const rt = sampleRuntime({ screens: createSampleFiles().data.screens, call: async () => ({}) });
  const draw = (m: MountRow): string => renderToStaticMarkup(<MountStrip rt={{ ...rt, clock: () => ({ now: NOW, offsetMin: 0 }) }} mount={m} onUnmount={() => undefined} onChanged={() => undefined} /> as ReactElement).replaceAll("<!-- -->", "");
  const out = draw(row());
  assert.match(out, /GitHub acme\/site/);
  for (const id of ["mount-sync", "mount-pause", "mount-unmount"]) assert.match(out, new RegExp(`data-testid="${id}"`));
  assert.doesNotMatch(out, /data-testid="mount-resume"/);
  assert.match(draw(row({ state: "paused" })), /data-testid="mount-resume"/);
  assert.doesNotMatch(draw(row({ kind: "local", state: "idle" })), /data-testid="mount-sync"/, "no Sync now for a computer's folder");
});
