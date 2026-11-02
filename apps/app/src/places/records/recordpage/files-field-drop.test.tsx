// A record's Files field takes files dropped on it or pasted into it: they are stored in the record's folder (the Attach path) and the field names them, after the ones it
// already had. Synthetic DataTransfers with File objects.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, textOf } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { RecordPage, RecordPageDataProvider } from "./index.ts";
import { createSamplePage } from "./sample.ts";

const ev = (dt: object) => { const e = { dataTransfer: dt, clipboardData: dt, prevented: 0, preventDefault() { e.prevented++; }, stopPropagation() { /* innermost zone */ } }; return e; };
async function fire(n: Node | null, name: string, e: object): Promise<void> {
  if (!n) throw new Error("node not found");
  await act(async () => { (n.props[name] as (x: object) => void)(e); });
  await flush();
}
const ids = (n: Node | string, out: string[] = []): string[] => { if (typeof n === "string") return out; const t = n.props["data-testid"]; if (typeof t === "string") out.push(t); (n.children ?? []).forEach((c) => ids(c, out)); return out; };

test("a file dropped on a Files field is stored in the record's folder and named in the field", async () => {
  const off = installDom();
  try {
    // a person who folded Contact: their folds replace the layout's, so Private (where the Files field sits) is open
    const s = createSamplePage(undefined, { prefs: { folded: ["contact"], keepVisible: [] } });
    const root = await mount(createRoot, <RecordPageDataProvider value={s.data}><RecordPage type="clients" recordId="cl_0" start={{ all: true, pane: false }} /></RecordPageDataProvider>);
    const zone = find(root, "drop-id_doc");
    assert.ok(zone, `the field is a drop zone (${ids(root).filter((i) => /private|id_doc/.test(i)).join(", ")})`);
    await fire(zone, "onDragEnter", ev({ types: ["Files"], files: [] }));
    assert.match(textOf(find(root, "drop-overlay")), /Drop to attach/);
    await fire(zone, "onDrop", ev({ types: ["Files"], files: [new File([new Uint8Array([1])], "Passport.pdf", { type: "application/pdf" })] }));
    for (let i = 0; i < 20 && !s.calls.some((c) => c.cap === "records.update"); i++) await flush();
    assert.deepEqual(s.attached.map((a) => a.name), ["Passport.pdf"], "stored the way Attach stores");
    const update = s.calls.find((c) => c.cap === "records.update")!.input as { patch: Record<string, unknown> };
    assert.deepEqual(update.patch, { id_doc: ["fil_1"] });
  } finally { off(); }
});
