// An automation step's file lines (an email's Attachments, a text's Media) take files dropped on them or pasted into them: the files are stored in Chat uploads (the
// composer's path) and their ids are added after the ones already there. Synthetic DataTransfers with File objects.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, textOf } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { AutomationsDataProvider } from "../canvas/data.tsx";
import { createSampleAutomations } from "../sidebar/sample.ts";
import { FilesLine } from "./MessageComposer.tsx";

const ev = (dt: object) => { const e = { dataTransfer: dt, clipboardData: dt, prevented: 0, preventDefault() { e.prevented++; }, stopPropagation() { /* innermost zone */ } }; return e; };
async function fire(n: Node | null, name: string, e: object): Promise<void> {
  if (!n) throw new Error("node not found");
  await act(async () => { (n.props[name] as (x: object) => void)(e); });
  await flush();
}

// The line on its own (the text step around it draws the rich editor, which a test renderer cannot drive): MessageComposer puts it under Attachments and Media.
test("a picture dropped on a text step's Media line is stored and its id added after the ones there", async () => {
  const off = installDom();
  try {
    const s = createSampleAutomations();
    let made = 0;
    const stored: string[] = [];
    const data = {
      ...s.data,
      call: async (cap: string, input: unknown): Promise<unknown> => {
        if (cap === "files.tree") return { roots: [{ key: "personal", title: "Personal", kind: "folder", folderId: "fld_me", count: 0 }] };
        if (cap === "files.list") return { files: [], folders: [{ folderId: "fld_uploads", name: "Chat uploads" }], hasMore: false };
        if (cap === "files.create") { stored.push((input as { folderId: string }).folderId); return { file: { fileId: `fil_${++made}`, name: (input as { name: string }).name } }; }
        return s.data.call(cap, input);
      },
    };
    const inputs: Array<readonly string[]> = [];
    const root = await mount(createRoot, <AutomationsDataProvider value={data}><FilesLine label="Media" testID="composer-media" ids={["fil_0"]} onIds={(ids) => inputs.push(ids)} /></AutomationsDataProvider>);
    const zone = find(root, "composer-media-drop");
    await fire(zone, "onDragEnter", ev({ types: ["Files"], files: [] }));
    assert.match(textOf(find(root, "drop-overlay")), /Drop to attach/);
    await fire(zone, "onDrop", ev({ types: ["Files"], files: [new File([new Uint8Array([1])], "Map.png", { type: "image/png" })] }));
    for (let i = 0; i < 20 && inputs.length === 0; i++) await flush();
    assert.deepEqual(stored, ["fld_uploads"]);
    assert.deepEqual(inputs.at(-1), ["fil_0", "fil_1"]);
  } finally { off(); }
});
