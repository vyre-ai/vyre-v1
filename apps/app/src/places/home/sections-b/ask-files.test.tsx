// Home's Ask box takes a dropped or pasted file like a chat does: it is stored in Chat uploads and posted with the question, never left behind with a "not sent" note.
// Synthetic DataTransfers with File objects.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { Composer } from "../../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { publishProgress } from "../../../onboarding/store.ts";
import Home from "../index.tsx";
import { homeBSlots } from "./index.ts";
import { startAsk } from "./actions.ts";
import { createSampleHomeB } from "./sample.ts";

installComposerForTests(Composer);

const ev = (dt: object) => { const e = { dataTransfer: dt, clipboardData: dt, prevented: 0, preventDefault() { e.prevented++; }, stopPropagation() { /* innermost zone */ } }; return e; };
async function fire(n: Node | null, name: string, e: object): Promise<void> {
  if (!n) throw new Error("node not found");
  await act(async () => { (n.props[name] as (x: object) => void)(e); });
  await flush();
}

test("an ask with files is posted the way a chat posts, with the file ids", async () => {
  const h = createSampleHomeB();
  const notes: string[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => (cap === "chat.post" ? (h.calls.push({ cap, input }), { message: { messageId: "msg_1", threadSeq: 1 } }) : h.data.call(cap, input));
  const thread = await startAsk({ call, note: (t) => void notes.push(t) }, "agt_assistant", "What is this?", 7, { attachments: ["fil_9"] });
  assert.equal(thread, "thr_new1");
  const start = h.calls.find((c) => c.cap === "chat.start")!.input as Record<string, unknown>;
  assert.equal(start["first"], undefined);
  const post = h.calls.find((c) => c.cap === "chat.post")!.input as Record<string, unknown>;
  assert.deepEqual([post["body"], post["attachments"]], ["What is this?", ["fil_9"]]);
  assert.deepEqual(notes, []);
});

test("a screenshot pasted into the Ask box goes with the question, stored in Chat uploads", async () => {
  const restore = installDom();
  publishProgress(null);
  const h = createSampleHomeB("northwind", { aiConnected: true });
  let made = 0;
  const base = h.data.call;
  h.data.call = async (cap: string, input: unknown) => {
    if (cap === "files.tree") { h.calls.push({ cap, input }); return { roots: [{ key: "personal", title: "Personal", kind: "folder", folderId: "fld_me", count: 0 }] }; }
    if (cap === "files.list") return { files: [], folders: [{ folderId: "fld_uploads", name: "Chat uploads" }], hasMore: false };
    if (cap === "files.create") { h.calls.push({ cap, input }); return { file: { fileId: `fil_${++made}`, name: (input as { name: string }).name } }; }
    if (cap === "chat.post") { h.calls.push({ cap, input }); return { message: { messageId: "msg_1", threadSeq: 1 } }; }
    return base(cap, input);
  };
  const opened: unknown[] = [];
  h.data.nav = { ...h.data.nav, openSubject: (s: unknown) => void opened.push(s) } as typeof h.data.nav;
  const { top, bottom } = homeBSlots(h.extras);
  const r = createRoot();
  try {
    await act(async () => { r.render(<Home data={h.data} top={top} bottom={bottom} personal={false} />); });
    await flush(); await flush();
    const root = r.container as unknown as Node;
    const box = find(root, "ask-box-drop");
    const paste = ev({ types: ["Files"], files: [new File([new Uint8Array([7])], "image.png", { type: "image/png" })] });
    await fire(box, "onPaste", paste);
    assert.equal(paste.prevented, 1);
    assert.match(textOf(find(root, "composer-file-0")), /Pasted image/);
    await press(find(root, "composer-send"));
    for (let i = 0; i < 20 && !h.calls.some((c) => c.cap === "chat.post"); i++) await flush();
    const create = h.calls.find((c) => c.cap === "files.create")!.input as Record<string, unknown>;
    assert.match(String(create["name"]), /^Pasted image .*\.png$/);
    const post = h.calls.find((c) => c.cap === "chat.post")!.input as Record<string, unknown>;
    assert.deepEqual(post["attachments"], ["fil_1"]);
    assert.equal(post["body"], "", "a file alone is a question too");
    for (let i = 0; i < 10 && opened.length === 0; i++) await flush();
    assert.deepEqual(opened, [{ type: "thread", id: "thr_new1" }], "and the chat opens");
  } finally { await act(async () => { r.unmount(); }); restore(); }
});
