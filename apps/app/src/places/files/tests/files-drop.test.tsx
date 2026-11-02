// Files: files dropped on the list, or pasted while it has focus, upload into the open folder the way Upload does. Where the list is not a folder (Recent, Trash) a drop
// does nothing and the window does not open the file. The shell's side stores them through the same storeFiles path. Synthetic DataTransfers with File objects.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, textOf } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { FilesList } from "../list/index.ts";
import { createSampleFiles } from "../list/sample.ts";
import { FilesDataProvider, FilesStateProvider } from "../tree/index.ts";
import type { FilesState } from "../tree/index.ts";
import { storeInto } from "../../../shell/providers/files-actions.ts";

const ev = (dt: object) => { const e = { dataTransfer: dt, clipboardData: dt, prevented: 0, preventDefault() { e.prevented++; }, stopPropagation() { /* innermost zone */ } }; return e; };
async function fire(n: Node | null, name: string, e: object): Promise<void> {
  if (!n) throw new Error("node not found");
  await act(async () => { (n.props[name] as (x: object) => void)(e); });
  await flush();
}

async function list(initial: Partial<FilesState>) {
  const s = createSampleFiles();
  const got: Array<{ folder: string | null; names: string[] }> = [];
  const data = { ...s.data, nav: { ...s.data.nav, uploadFiles: (folder: string | null, files: readonly { name: string }[]) => void got.push({ folder, names: files.map((f) => f.name) }) } };
  const root = await mount(createRoot, <FilesDataProvider value={data}><FilesStateProvider initial={initial}><FilesList /></FilesStateProvider></FilesDataProvider>);
  return { root, got };
}

test("a file dropped on an open folder's list uploads into that folder", async () => {
  const off = installDom();
  try {
    const { root, got } = await list({ where: { kind: "folder", id: "fld_sales" } });
    const zone = find(root, "files-drop");
    await fire(zone, "onDragEnter", ev({ types: ["Files"], files: [] }));
    assert.match(textOf(find(root, "drop-overlay")), /Drop to upload/);
    const shot = new File([new Uint8Array([1])], "Screenshot 2026-11-03 at 10.14.02.png", { type: "image/png" });
    const drop = ev({ types: ["Files"], files: [shot] });
    await fire(zone, "onDrop", drop);
    assert.equal(drop.prevented, 1);
    assert.deepEqual(got, [{ folder: "fld_sales", names: [shot.name] }]);
    await fire(zone, "onPaste", ev({ types: ["Files"], files: [new File([new Uint8Array([2])], "image.png", { type: "image/png" })] }));
    assert.equal(got.length, 2, "Cmd-V of a screenshot uploads too");
    assert.match(got[1]!.names[0]!, /^Pasted image /);
  } finally { off(); }
});

test("in Trash a drop does nothing and the window does not open the file", async () => {
  const off = installDom();
  try {
    const { root, got } = await list({ where: { kind: "trash" } });
    const zone = find(root, "files-drop");
    await fire(zone, "onDragEnter", ev({ types: ["Files"], files: [] }));
    assert.equal(find(root, "drop-overlay"), null);
    const drop = ev({ types: ["Files"], files: [new File([new Uint8Array([1])], "a.png")] });
    await fire(zone, "onDrop", drop);
    assert.equal(drop.prevented, 1);
    assert.deepEqual(got, []);
  } finally { off(); }
});

test("the shell stores dropped files in the folder through the same path as Upload", async () => {
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "files.create") return { file: { fileId: "fil_1", name: (input as { name: string }).name } };
    throw new Error(`unexpected ${cap}`);
  };
  const n = await storeInto(call, undefined, "fld_sales", [{ name: "Notes.txt", mime: "text/plain", file: new File(["hi"], "Notes.txt", { type: "text/plain" }) }]);
  assert.equal(n, 1);
  assert.deepEqual([calls[0]!.cap, calls[0]!.input["folderId"], calls[0]!.input["name"], calls[0]!.input["content"]], ["files.create", "fld_sales", "Notes.txt", { base64: "aGk=" }]);
  assert.equal(await storeInto(call, undefined, "fld_sales", []), 0, "nothing chosen, nothing stored");
});
