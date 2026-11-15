// An open file always shows where it is: the folder list's own Breadcrumb (the way out is the shell's Back, not a control of the file's own). From a folder the path is the folders; from Recent, Starred, Shared with me, Trash or
// Knowledge it is that place; a folder the person may not open is words, never a link.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { installDom, mount, find, press, textOf, flush } from "../../../../../../ui/src/testing/dom.ts";
import { FileTrail, fileTrail } from "../viewer/FileTrail.tsx";
import { upHash } from "../../../shell/tabs/store.ts";
import { createSampleFiles, northwind } from "../list/sample.ts";
import { FilesDataProvider, FilesStateProvider } from "../tree/index.ts";
import type { FilesState, Where } from "../tree/index.ts";

const nodes = [
  { id: "a", name: "Marketing", parentId: null },
  { id: "b", name: "Brand", parentId: "a" },
];
const names = (c: readonly { name: string }[]): string[] => c.map((x) => x.name);

test("the trail: from a folder it is Files and the folders to the file; from each place it is that place; the last crumb is the file", () => {
  const file = { name: "Northwind logo.png", folderId: "b" };
  assert.deepEqual(names(fileTrail({ kind: "folder", id: "b" }, nodes, file)), [
    "Files",
    "Marketing",
    "Brand",
    "Northwind logo.png",
  ]);
  const places: [Where["kind"], string][] = [
    ["recent", "Recent"],
    ["starred", "Starred"],
    ["shared", "Shared with me"],
    ["trash", "Trash"],
    ["knowledge", "Knowledge"],
  ];
  for (const [kind, label] of places) {
    const t = fileTrail({ kind } as Where, nodes, file);
    assert.deepEqual(names(t), [label, "Northwind logo.png"], kind);
    assert.equal(t[0]!.id, `place:${kind}`);
  }
  // a file in a folder the person cannot see: only what they can open is on the path
  assert.deepEqual(names(fileTrail({ kind: "folder", id: null }, nodes, { name: "x.png", folderId: "hidden" })), [
    "Files",
    "x.png",
  ]);
  assert.equal(fileTrail({ kind: "folder", id: null }, nodes, null).at(-1)!.name, "");
});

async function rig(where: Where, file: { name: string; folderId: string }) {
  const s = createSampleFiles(northwind);
  const data = {
    ...s.data,
    call: async (cap: string, input: unknown): Promise<unknown> =>
      cap === "files.get" ? { file: { fileId: "f", ...file } } : s.data.call(cap, input),
  };
  const left: string[] = [];
  const root = await mount(
    createRoot,
    <FilesDataProvider value={data}>
      <FilesStateProvider initial={{ where } as Partial<FilesState>}>
        <FileTrail fileId="f" onGo={(id) => left.push(String(id))} />
      </FilesStateProvider>
    </FilesDataProvider>,
  );
  await flush();
  return { root, left };
}

test("the path names the place and carries no Back control of its own: leaving a file is the shell's Back; the folder is told to the shell so a cold file goes up to it", async () => {
  const restore = installDom();
  try {
    assert.equal(upHash("subject=file:f"), "", "a file this page has not read goes up to the Files landing");
    const { root, left } = await rig({ kind: "shared" }, { name: "Northwind logo.png", folderId: "fld_daily" });
    assert.match(textOf(find(root, "files-path")), /Shared with me/);
    assert.match(textOf(find(root, "files-title")), /Northwind logo\.png/);
    assert.equal(find(root, "file-back"), null, "no second back control");
    assert.deepEqual(left, [], "nothing left on its own");
    assert.equal(
      upHash("subject=file:f"),
      "subject=folder:fld_daily",
      "read once, a file opened cold goes up to a folder the person can list",
    );
    // the same file now sits in a folder the person cannot list (shared into a private folder): it is forgotten, and Back goes to the Files landing
    await rig({ kind: "shared" }, { name: "Northwind logo.png", folderId: "fld_private_elsewhere" });
    assert.equal(upHash("subject=file:f"), "", "never up to a folder that would refuse");
    assert.equal(upHash("subject=file:other"), "", "another file is not placed by it");
  } finally {
    restore();
  }
});

test("a crumb for a folder the person cannot open is words, not a link", async () => {
  const restore = installDom();
  try {
    const { root } = await rig({ kind: "folder", id: null }, { name: "logo.png", folderId: "fld_nowhere" });
    assert.ok(find(root, "files-crumb-root"), "Files is a link");
    assert.equal(find(root, "files-crumb-fld_nowhere"), null, "no crumb for what is not visible");
  } finally {
    restore();
  }
});
