// Local folders in Files (rc.7): "This computer" in the mount sheet opens the system folder dialog and mounts the pick at once (no in-dialog browser: the server cannot list a device's
// folders); the web and the phone say where to add one; a mounted folder shows in the sidebar with its source mark; a Personal Space has no Shared with me.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { find, flush, installDom, press } from "../../../onboarding/test-dom.ts";
import { MountSheet, MountsDataProvider } from "../mounts/index.ts";
import { createSampleMounts } from "../mounts/sample.ts";
import { createSampleFiles, northwind } from "../list/sample.ts";
import { FilesDataProvider, FilesStateProvider, FilesTree } from "../tree/index.ts";
import { writableFolders } from "../../../shell/providers/files-mounts-data.ts";

async function openSheet(invoke: ((c: string, a?: Record<string, unknown>) => Promise<unknown>) | undefined, picks: string[] = ["/Users/irfad/Claude"]) {
  installDom();
  const s = createSampleMounts();
  const dialogs: unknown[] = [];
  const mounted: unknown[] = [];
  const inv = invoke === undefined ? undefined : async (cmd: string, args?: Record<string, unknown>) => { dialogs.push({ cmd, args }); return picks; };
  const r = createRoot();
  await act(async () => {
    r.render(<MountsDataProvider value={s.data}><MountSheet onClose={() => undefined} onMounted={(i) => { mounted.push(i); }} {...(inv ? { invoke: inv } : { invoke: undefined })} /></MountsDataProvider>);
  });
  await flush();
  return { s, dialogs, mounted, root: r.container as never };
}

test("This computer opens the native folder dialog and mounts the pick live only, with no in-dialog browser", async () => {
  const t = await openSheet(async () => []);
  await press(find(t.root, "row-source:local"));
  await flush();
  assert.deepEqual(t.dialogs, [{ cmd: "pick_paths", args: { options: { title: "Choose a folder", multiple: false, directory: true, filters: [] } } }]);
  assert.equal(find(t.root, "mount-pick"), null, "no browser step");
  const add = t.s.calls.filter((c) => c.cap === "mounts.add");
  assert.equal(add.length, 1);
  assert.deepEqual(add[0]!.input, { into: "fld_github", source: { kind: "local", deviceId: "dev_macbook", localPath: "/Users/irfad/Claude" }, name: "Claude", mode: "live_only", idempotencyKey: "mount:local:/Users/irfad/Claude:fld_github" });
  assert.equal(t.mounted.length, 1);
  assert.equal((t.mounted[0] as { name: string }).name, "Claude");
});

test("a closed dialog mounts nothing; without the shell the sheet says where local folders are added", async () => {
  const none = await openSheet(async () => [], []);
  await press(find(none.root, "row-source:local"));
  await flush();
  assert.equal(none.s.calls.filter((c) => c.cap === "mounts.add").length, 0);
  assert.equal(none.mounted.length, 0);
  const web = await openSheet(undefined);
  await press(find(web.root, "row-source:local"));
  await flush();
  assert.deepEqual(web.dialogs, []);
  assert.equal(web.s.calls.filter((c) => c.cap === "mounts.add").length, 0);
  assert.ok(JSON.stringify(web.root).includes("Local folders are added from the Mac or PC app."), "one line says where");
});

test("a failed mount from the dialog stays in the sheet with a line", async () => {
  const t = await openSheet(async () => []);
  t.s.failNext("mounts.add", "provider.unavailable");
  await press(find(t.root, "row-source:local"));
  await flush();
  assert.equal(t.mounted.length, 0);
  assert.ok(find(t.root, "mount-sheet"), "the sheet stays");
});

test("the folders a mount can go into start with Personal from files.tree, even when it holds nothing yet", async () => {
  const call = async (cap: string): Promise<unknown> => cap === "files.tree" ? { roots: [{ key: "recent", title: "Recent", kind: "virtual", count: 0 }, { key: "personal", title: "Personal", kind: "folder", folderId: "fld_me", count: 0 }] } : { folders: [{ folderId: "fld_kid", name: "Kid" }] };
  assert.deepEqual(await writableFolders(call), [{ id: "fld_me", name: "Personal" }, { id: "fld_kid", name: "Kid" }]);
  assert.deepEqual(await writableFolders(async (cap) => { if (cap === "files.tree") throw new Error("x"); return { folders: [{ folderId: "a", name: "A" }] }; }), [{ id: "a", name: "A" }]);
});

const tree = (data: object): string => renderToStaticMarkup(<FilesDataProvider value={data as never}><FilesStateProvider initial={{}}><FilesTree /></FilesStateProvider></FilesDataProvider>).replaceAll("<!-- -->", "");

test("a mounted folder is listed under Space with its source mark, and a Personal Space has no Shared with me", () => {
  const space = { ...northwind, folders: [...northwind.folders, { id: "fld_mnt", name: "Claude", parent: null, section: "personal" as const, source: { mountId: "mnt_1", provider: "This computer" } }] };
  const team = tree(createSampleFiles(space).data);
  assert.ok(team.includes('data-testid="row-folder-fld_mnt"') && team.includes(">Claude<"), "the mounted folder is a row");
  assert.ok(team.includes('data-testid="mount-mark-fld_mnt"'), "with the mark of its source");
  assert.ok(team.includes("Shared with me"), "a Team Space keeps Shared with me");
  const personal = tree({ ...createSampleFiles(space).data, personal: true });
  assert.ok(!personal.includes("Shared with me"), "a Personal Space has none");
  assert.ok(personal.includes(">Recent<") && personal.includes(">Starred<"));
  assert.ok(personal.includes('data-testid="row-folder-fld_mnt"'));
});
