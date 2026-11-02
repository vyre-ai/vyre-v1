// An Inbox reply takes files the way a chat does: dropped on the reply or pasted into it, they are stored in Chat uploads (the composer's path) and go as the email's
// attachments or the text's pictures. Synthetic DataTransfers with File objects.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { Composer } from "../../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../../ui/src/Composer/Deferred.tsx";
import { ContactTab } from "../contacttab/index.ts";
import { initialDraft, mailInput, smsInput } from "../contacttab/model.ts";
import type { InboxChoice, ThreadOut } from "../contacttab/model.ts";
import { createContactTabSample } from "../contacttab/sample.ts";
import { InboxDataProvider } from "../sidebar/index.ts";

installComposerForTests(Composer);

const ev = (dt: object) => { const e = { dataTransfer: dt, clipboardData: dt, prevented: 0, preventDefault() { e.prevented++; }, stopPropagation() { /* innermost zone */ } }; return e; };
async function fire(n: Node | null, name: string, e: object): Promise<void> {
  if (!n) throw new Error("node not found");
  await act(async () => { (n.props[name] as (x: object) => void)(e); });
  await flush();
}

test("the files of a reply go as an email's attachments and a text's pictures", () => {
  const s = createContactTabSample();
  const th = s.replica.run("inbox.thread", { conversationId: "elena" })!.data as ThreadOut;
  const d = { ...initialDraft(th.conversation, "email", th.items), text: "Here it is.", fileIds: ["fil_1", "fil_2"] };
  const box: InboxChoice = { id: "mbx_work", kind: "mailbox", address: "me@x.test", label: "Work Gmail", isDefault: true };
  assert.deepEqual(mailInput(d, box, th.conversation, "k").attachments, ["fil_1", "fil_2"]);
  assert.deepEqual(smsInput({ ...d, chan: "sms" }, { ...box, id: "num_1", kind: "number" }, th.conversation, "+1", "k").mediaFileIds, ["fil_1", "fil_2"]);
  assert.equal(mailInput({ ...d, fileIds: [] }, box, th.conversation, "k").attachments, undefined, "nothing extra without files");
});

test("a file dropped on an email reply is stored and sent as its attachment", async () => {
  const off = installDom();
  try {
    const s = createContactTabSample();
    let made = 0;
    const base = s.data.call;
    const stored: string[] = [];
    s.data.call = async (cap: string, input: unknown) => {
      if (cap === "files.tree") return { roots: [{ key: "personal", title: "Personal", kind: "folder", folderId: "fld_me", count: 0 }] };
      if (cap === "files.list") return { files: [], folders: [{ folderId: "fld_uploads", name: "Chat uploads" }], hasMore: false };
      if (cap === "files.create") { stored.push((input as { folderId: string }).folderId); return { file: { fileId: `fil_${++made}`, name: (input as { name: string }).name } }; }
      return base(cap, input);
    };
    const contact = (s.replica.rows("contacts") as unknown as { id: string; contactId?: string }[]).find((c) => c.id === "elena");
    const root = await mount(createRoot, <InboxDataProvider value={s.data}><ContactTab conversationId="elena" {...(contact?.contactId ? { contactId: contact.contactId } : {})} /></InboxDataProvider>);
    const host = find(root, "contact-composer-field-drop");
    await fire(host, "onDragEnter", ev({ types: ["Files"], files: [] }));
    assert.match(textOf(find(root, "contact-composer-field-drop-overlay")), /Drop to attach/);
    await fire(host, "onDrop", ev({ types: ["Files"], files: [new File([new Uint8Array([1, 2])], "Signed lease.pdf", { type: "application/pdf" })] }));
    assert.match(textOf(find(root, "composer-file-0")), /Signed lease\.pdf/);
    await typeInto(find(root, "composer-field"), "Signed copy attached.");
    await press(find(root, "composer-send"));
    for (let i = 0; i < 20 && s.sent.length === 0; i++) await flush();
    assert.equal(s.sent.length, 1);
    assert.equal(s.sent[0]!.cap, "mail.send");
    assert.deepEqual((s.sent[0]!.input as { attachments?: string[] }).attachments, ["fil_1"]);
    assert.equal((s.sent[0]!.input as { text?: string }).text, "Signed copy attached.");
    assert.deepEqual(stored, ["fld_uploads"]);
  } finally { off(); }
});
