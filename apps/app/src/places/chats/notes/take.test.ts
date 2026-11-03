// Take a note: the bar opens in place, a paste becomes an image, a link card or text, an empty note is dropped, and the foot bar's Undo after a delete.
import test from "node:test";
import assert from "node:assert/strict";
import { CLOSED, barStep, createInput, fromDataUri, loneLink, pasteKind, takeIsEmpty, takeStep } from "./take.ts";
import type { Take, TakeAct } from "./take.ts";

const run = (acts: TakeAct[], from: Take = CLOSED): Take => acts.reduce(takeStep, from);
const PNG = "data:image/png;base64,iVBORw0KGgo=";

test("the bar opens in place and an empty note is dropped on close", () => {
  const open = run([{ t: "open" }]);
  assert.equal(open.open, true);
  assert.equal(takeIsEmpty(open), true);
  assert.equal(createInput(open, "k1"), null, "nothing typed, no image, no link: nothing is made");
  assert.equal(createInput(run([{ t: "open" }, { t: "title", v: "   " }, { t: "body", v: "\n" }]), "k1"), null, "only spaces count as empty");
  assert.deepEqual(run([{ t: "open" }, { t: "body", v: "x" }, { t: "reset" }]), CLOSED);
});

test("what is typed, coloured, labelled and pinned goes to notes.create", () => {
  const t = run([{ t: "open" }, { t: "title", v: " JCS Law, Windows setup " }, { t: "body", v: "Send Josh the installer link.\n" }, { t: "color", c: "sky" }, { t: "pin" }, { t: "label", name: "Clients" }, { t: "label", name: "Lab 8" }, { t: "label", name: "Lab 8" }]);
  assert.deepEqual(createInput(t, "k2"), { idempotencyKey: "k2", title: "JCS Law, Windows setup", body: "Send Josh the installer link.", color: "sky", pinned: true, labels: ["Clients"] });
  assert.equal(run([{ t: "pin" }, { t: "pin" }]).pinned, false);
});

test("a pasted image becomes the note's picture, and a note with only a picture is kept", () => {
  const img = fromDataUri(PNG)!;
  assert.deepEqual(img, { contentType: "image/png", data: "iVBORw0KGgo=", uri: PNG });
  assert.equal(fromDataUri("data:image/svg+xml;base64,PHN2Zz4="), null, "a kind a note does not keep");
  const t = run([{ t: "image", image: img }]);
  assert.equal(t.open, true, "pasting opens the bar");
  assert.deepEqual(createInput(t, "k3"), { idempotencyKey: "k3", image: { data: "iVBORw0KGgo=", contentType: "image/png" } });
  assert.equal(run([{ t: "image", image: img }, { t: "rm-image" }]).image, null);
});

test("a pasted link reads, then becomes a card; a late answer for another link is dropped; the link is kept even before it is read", () => {
  const reading = run([{ t: "reading", url: "https://skool.com/mla-ai-labs/lab-8" }]);
  assert.equal(reading.open, true);
  assert.equal(reading.reading, "https://skool.com/mla-ai-labs/lab-8");
  assert.deepEqual(createInput(reading, "k4"), { idempotencyKey: "k4", link: "https://skool.com/mla-ai-labs/lab-8" }, "closing before it is read keeps the link; the server reads it");
  const card = takeStep(reading, { t: "read", link: { url: "https://skool.com/mla-ai-labs/lab-8/", title: "Lab 8", siteName: "Skool" } });
  assert.equal(card.reading, null);
  assert.equal(card.link?.title, "Lab 8", "a trailing slash is the same link");
  assert.deepEqual(takeStep(reading, { t: "read", link: { url: "https://other.com" } }), reading, "an answer for another link changes nothing");
  assert.deepEqual(takeStep(CLOSED, { t: "read", link: { url: "https://skool.com" } }), CLOSED, "an answer after the link was removed changes nothing");
  assert.equal(takeStep(card, { t: "rm-link" }).link, null);
});

test("what a paste is: an image, a lone link, or text; in another field only an image or a link is taken, and there it is left alone", () => {
  assert.deepEqual(pasteKind({ files: [{ type: "text/plain" }, { type: "image/jpeg" }], text: "x" }, false), { kind: "image", index: 1 });
  assert.equal(pasteKind({ files: [{ type: "image/svg+xml" }], text: "" }, false), null, "an image kind a note does not keep is left alone");
  assert.deepEqual(pasteKind({ files: [], text: "  https://docs.lawmatics.com/custom-fields \n" }, false), { kind: "link", url: "https://docs.lawmatics.com/custom-fields" });
  assert.deepEqual(pasteKind({ files: [], text: "see https://a.com" }, false), { kind: "text", text: "see https://a.com" }, "a link inside text stays text");
  assert.equal(pasteKind({ files: [], text: "  " }, false), null);
  assert.equal(pasteKind({ files: [], text: "hello" }, true), null, "the search box keeps its own paste");
  assert.equal(pasteKind({ files: [{ type: "image/png" }], text: "" }, true), null);
  assert.equal(loneLink("ftp://x.com"), null);
  assert.equal(loneLink("http://x.com/a?b=c"), "http://x.com/a?b=c");
  const t = run([{ t: "paste-text", text: "one" }, { t: "paste-text", text: "two" }]);
  assert.equal(t.open, true);
  assert.equal(t.body, "one\ntwo");
});

test("who sees a new note is chosen in the bar", () => {
  assert.equal(run([{ t: "share", v: "space" }]).share, "space");
  assert.equal(CLOSED.share, "private", "private by default");
});

test("the foot bar: a delete offers Undo until it is undone or replaced", () => {
  const del = barStep(null, { t: "deleted", noteId: "n1", mine: true });
  assert.deepEqual(del, { text: "Note deleted", undo: "n1" });
  assert.deepEqual(barStep(null, { t: "deleted", noteId: "n6", mine: false }), { text: "Removed from your notes", undo: "n6" });
  assert.equal(barStep(del, { t: "undone" }), null);
  assert.deepEqual(barStep(del, { t: "say", text: "Pinned" }), { text: "Pinned" }, "the next line replaces the Undo");
  assert.deepEqual(barStep({ text: "Pinned" }, { t: "undone" }), { text: "Pinned" }, "Undo with nothing to undo leaves the line");
  assert.equal(barStep(del, { t: "dismiss" }), null);
  assert.deepEqual(barStep(null, { t: "saved", noteId: "n9", text: "Saved to Notes" }), { text: "Saved to Notes", open: "n9" });
});
