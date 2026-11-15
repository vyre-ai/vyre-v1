// An open file always shows where it is and the way out: a Back arrow and the folder list's own Breadcrumb. From a folder the path is the folders; from Recent, Starred, Shared with me, Trash or
// Knowledge it is that place; a folder the person may not open is words, never a link; Back and Esc leave to the list as it was; Esc is not taken from a field, a menu or a markup tool.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { installDom, mount, find, press, textOf, flush } from "../../../../../../ui/src/testing/dom.ts";
import { FileTrail, escapeLeaves, fileTrail } from "../viewer/FileTrail.tsx";
import { createSampleFiles, northwind } from "../list/sample.ts";
import { FilesDataProvider, FilesStateProvider } from "../tree/index.ts";
import type { FilesState, Where } from "../tree/index.ts";

const nodes = [
  { id: "a", name: "Marketing", parentId: null },
  { id: "b", name: "Brand", parentId: "a" },
];
const names = (c: readonly { name: string }[]): string[] => c.map((x) => x.name);

test("the trail: from a folder it is Files and the folders to the file; from each place it is that place; the last crumb is the file", () => {
  const file = { name: "MLA logo.png", folderId: "b" };
  assert.deepEqual(names(fileTrail({ kind: "folder", id: "b" }, nodes, file)), [
    "Files",
    "Marketing",
    "Brand",
    "MLA logo.png",
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
    assert.deepEqual(names(t), [label, "MLA logo.png"], kind);
    assert.equal(t[0]!.id, `place:${kind}`);
  }
  // a file in a folder the person cannot see: only what they can open is on the path
  assert.deepEqual(names(fileTrail({ kind: "folder", id: null }, nodes, { name: "x.png", folderId: "hidden" })), [
    "Files",
    "x.png",
  ]);
  assert.equal(fileTrail({ kind: "folder", id: null }, nodes, null).at(-1)!.name, "");
});

test("Esc leaves unless a field, a menu or dialog, or a markup tool has it", () => {
  assert.equal(escapeLeaves({ key: "Escape", defaultPrevented: false, target: { tagName: "DIV" } }), true);
  assert.equal(
    escapeLeaves({ key: "Escape", defaultPrevented: true, target: { tagName: "DIV" } }),
    false,
    "taken (Draw mode)",
  );
  assert.equal(escapeLeaves({ key: "Escape", defaultPrevented: false, target: { tagName: "TEXTAREA" } }), false);
  assert.equal(escapeLeaves({ key: "Escape", defaultPrevented: false, target: { tagName: "INPUT" } }), false);
  assert.equal(escapeLeaves({ key: "Escape", defaultPrevented: false, target: { isContentEditable: true } }), false);
  assert.equal(escapeLeaves({ key: "a", defaultPrevented: false }), false);
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
        <FileTrail fileId="f" onBack={() => left.push("back")} />
      </FilesStateProvider>
    </FilesDataProvider>,
  );
  await flush();
  return { root, left };
}

test("the Back arrow leaves the file; the path names the place; Esc does the same and leaves a field, a menu and a taken key alone", async () => {
  const restore = installDom();
  const g = globalThis as { document: Record<string, unknown> };
  const before = g.document;
  const keys: ((e: unknown) => void)[] = [];
  let menuOpen = false;
  g.document = {
    ...before,
    addEventListener: (t: string, f: (e: unknown) => void) => void (t === "keydown" && keys.push(f)),
    removeEventListener: () => undefined,
    querySelector: () => (menuOpen ? {} : null),
  };
  try {
    const { root, left } = await rig({ kind: "shared" }, { name: "MLA logo.png", folderId: "unseen" });
    assert.match(textOf(find(root, "files-path")), /Shared with me/);
    assert.match(textOf(find(root, "files-title")), /MLA logo\.png/);
    await press(find(root, "file-back"));
    assert.deepEqual(left, ["back"]);
    const esc = (o: object = {}): void =>
      keys.forEach((f) => f({ key: "Escape", defaultPrevented: false, target: { tagName: "DIV" }, ...o }));
    esc();
    assert.equal(left.length, 2, "Esc leaves");
    esc({ target: { tagName: "INPUT" } });
    assert.equal(left.length, 2, "not from a field");
    esc({ defaultPrevented: true });
    assert.equal(left.length, 2, "not when a markup tool took it");
    menuOpen = true;
    esc();
    assert.equal(left.length, 2, "not with a menu or dialog open");
  } finally {
    g.document = before;
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
