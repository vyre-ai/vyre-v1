// A chat takes files dropped anywhere on its pane or pasted into its field: they land in the composer's tray, and the send stores them in Chat uploads and posts them with the
// words, the same path as Upload. A mounted folder dragged from Files is still shared, not attached. Synthetic DataTransfers with File objects.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../onboarding/test-dom.ts";
import type { Node } from "../../../onboarding/test-dom.ts";
import { Composer } from "../../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { Conversation } from "./Conversation.tsx";
import type { ConversationData } from "./data.tsx";
import { createSample } from "./sample.ts";

installComposerForTests(Composer);

type Call = { cap: string; input: Record<string, unknown> };
function rig(): { data: ConversationData; calls: Call[] } {
  const s = createSample("idle");
  const calls: Call[] = [];
  let made = 0;
  const data: ConversationData = {
    ...s.data,
    async call(cap, input) {
      calls.push({ cap, input: input as Record<string, unknown> });
      if (cap === "files.tree") return { roots: [{ key: "personal", title: "Personal", kind: "folder", folderId: "fld_me", count: 0 }] };
      if (cap === "files.list") return { files: [], folders: [{ folderId: "fld_uploads", name: "Chat uploads" }], hasMore: false };
      if (cap === "files.create") return { file: { fileId: `fil_${++made}`, name: (input as { name: string }).name } };
      return s.data.call(cap, input);
    },
  };
  return { data, calls };
}

const shot = new File([new Uint8Array([137, 80, 78, 71])], "Screenshot 2026-11-03 at 10.14.02.png", { type: "image/png" });
const ev = (dt: object) => { const e = { dataTransfer: dt, clipboardData: dt, prevented: 0, preventDefault() { e.prevented++; }, stopPropagation() { /* innermost zone */ } }; return e; };
async function fire(n: Node | null, name: string, e: object): Promise<void> {
  if (!n) throw new Error("node not found");
  await act(async () => { (n.props[name] as (x: object) => void)(e); });
  await flush();
}

test("a screenshot dropped anywhere on the chat pane lands in the composer and goes out stored in Chat uploads, attached to the message", async () => {
  installDom();
  const r = rig();
  const root = await mount(createRoot, <Conversation data={r.data} />);
  const pane = find(root, "conversation-drop");
  await fire(pane, "onDragEnter", ev({ types: ["Files"], files: [] }));
  assert.match(textOf(find(root, "drop-overlay")), /Drop to attach/, "the pane shows one calm line");
  const drop = ev({ types: ["Files"], files: [shot] });
  await fire(pane, "onDrop", drop);
  assert.equal(drop.prevented, 1, "the window never opens the file");
  assert.equal(find(root, "drop-overlay"), null);
  assert.match(textOf(find(root, "composer-file-0")), /Screenshot 2026-11-03/);
  await press(find(root, "composer-send"));
  for (let i = 0; i < 10 && !r.calls.some((c) => c.cap === "chat.post"); i++) await flush();
  const create = r.calls.find((c) => c.cap === "files.create");
  assert.equal(create?.input["folderId"], "fld_uploads");
  assert.equal(create?.input["name"], shot.name);
  assert.deepEqual(create?.input["content"], { base64: "iVBORw==" }, "the bytes of the screenshot");
  const post = r.calls.find((c) => c.cap === "chat.post");
  assert.deepEqual(post?.input["attachments"], ["fil_1"]);
});

test("Cmd-V of a screenshot in the chat's field attaches it the same way", async () => {
  installDom();
  const r = rig();
  const root = await mount(createRoot, <Conversation data={r.data} />);
  const field = find(root, "composer-drop");
  const paste = ev({ types: ["Files"], files: [new File([new Uint8Array([1])], "image.png", { type: "image/png" })] });
  await fire(field, "onPaste", paste);
  assert.equal(paste.prevented, 1);
  assert.match(textOf(find(root, "composer-file-0")), /Pasted image/);
});

test("a mounted folder dragged from Files onto the pane is still shared with the chat's agents, not attached", async () => {
  installDom();
  const r = rig();
  const root = await mount(createRoot, <Conversation data={r.data} />);
  const pane = find(root, "conversation-drop");
  const dt = { types: ["text/plain"], files: [], getData: () => "nothing-from-files" };
  const over = ev(dt);
  await fire(pane, "onDragOver", over);
  assert.equal(over.prevented, 1, "a text drag may still be dropped on the pane");
  await fire(pane, "onDrop", ev(dt));
  assert.equal(find(root, "composer-file-0"), null, "text is never a file");
});
