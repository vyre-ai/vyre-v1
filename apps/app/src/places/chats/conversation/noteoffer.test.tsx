// "Save as a note?" in the chat: the preview and Private to you, Save and Not now for the person it was made to and nobody else, a quiet "Saved to Notes · Open" after Save with no title, and nothing left
// after Not now.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { NoteOfferCard, isNoteOffer, noteOfferOf } from "./noteoffer.tsx";

const data = (over: Record<string, unknown> = {}) => ({ threadId: "thr_1", blockId: "blk_1", person: "usr_me", title: "Weinberger form link", body: "weinbergerlaw.com/intake-form", topic: "form", state: "offered", ...over });
function chat() {
  const calls: { cap: string; input: unknown }[] = [];
  const opened: string[] = [];
  return { calls, opened, chat: { threadId: "thr_1", call: async (cap: string, input: unknown) => { calls.push({ cap, input }); return { state: (input as { decision: string }).decision === "save" ? "saved" : "dismissed", noteId: "nte_1" }; }, nav: { openNote: (id: string) => opened.push(id) } } as never };
}

test("the block is read from its data, and anything else is not an offer", () => {
  assert.equal(isNoteOffer("note_offer"), true);
  assert.equal(noteOfferOf(data())?.title, "Weinberger form link");
  assert.equal(noteOfferOf({ blockId: "x" }), null);
  assert.equal(noteOfferOf(data({ state: "saved", noteId: "nte_9" }))?.noteId, "nte_9");
});

test("the person it was made to sees the preview, Private to you, Save and Not now; Save asks the server, then the card is a quiet saved line with Open", async () => {
  const off = installDom();
  try {
    const { calls, opened, chat: c } = chat();
    const root = await mount(createRoot, <NoteOfferCard id="b1" data={data()} mine chat={c} />);
    assert.match(textOf(find(root, "noteoffer-b1")), /Save as a note\?/);
    assert.match(textOf(find(root, "noteoffer-b1")), /Private to you/);
    assert.match(textOf(find(root, "noteoffer-preview-b1")), /Weinberger form link/);
    await press(find(root, "noteoffer-save-b1"));
    await flush();
    assert.deepEqual(calls, [{ cap: "chat.note_offer.answer", input: { threadId: "thr_1", blockId: "blk_1", decision: "save" } }]);
    assert.equal(find(root, "noteoffer-b1"), null);
    const line = textOf(find(root, "noteoffer-saved-b1"));
    assert.match(line, /Saved to Notes/);
    assert.ok(!line.includes("Weinberger"), "the line never says what the note holds");
    await press(find(root, "noteoffer-open-b1"));
    assert.deepEqual(opened, ["nte_1"]);
  } finally { off(); }
});

test("Not now closes the card and leaves nothing; someone else reading the chat sees the offer without buttons, and a saved line without Open", async () => {
  const off = installDom();
  try {
    const { calls, chat: c } = chat();
    const root = await mount(createRoot, <NoteOfferCard id="b2" data={data()} mine chat={c} />);
    await press(find(root, "noteoffer-dismiss-b2"));
    await flush();
    assert.equal(calls[0] && (calls[0].input as { decision: string }).decision, "dismiss");
    assert.equal(find(root, "noteoffer-b2"), null);
    assert.equal(find(root, "noteoffer-saved-b2"), null);
    const other = await mount(createRoot, <NoteOfferCard id="b3" data={data()} mine={false} chat={c} />);
    assert.match(textOf(find(other, "noteoffer-b3")), /Offered to someone else/);
    assert.equal(find(other, "noteoffer-save-b3"), null);
    const saved = await mount(createRoot, <NoteOfferCard id="b4" data={data({ state: "saved", noteId: "nte_1" })} mine={false} chat={c} />);
    assert.match(textOf(find(saved, "noteoffer-saved-b4")), /Saved to Notes/);
    assert.equal(find(saved, "noteoffer-open-b4"), null, "the note is the other person's; no Open");
    const gone = await mount(createRoot, <NoteOfferCard id="b5" data={data({ state: "dismissed" })} mine chat={c} />);
    assert.equal(find(gone, "noteoffer-b5"), null);
  } finally { off(); }
});
