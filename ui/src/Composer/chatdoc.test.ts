// The chat field's document: the composer's text and mention ranges become one paragraph with a chip for each mention and back, offsets and positions map both ways, and the document fits the field's real schema.
import test from "node:test";
import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";
import { chatDoc, chatText, offsetToPos, pasteNodes, posToOffset, sameDoc } from "./chatdoc.ts";
import { chatExtensions } from "./chatnode.ts";
import { tokenRanges } from "./brain.ts";

const schema = getSchema(chatExtensions());
const DRAFT = [
  "Kickoff notes for the Meier file.",
  "@Aliza please confirm that the engagement letter went out and that the client was able to sign it.",
  "The retainer is paid, the intake form is complete.",
  "@Rubab can you check the numbers on CX before Thursday, and tell us what is missing.",
  "I will draft the cover note tonight.",
  "@Sol keep an eye on the filing portal over the weekend.",
  "Thanks all.",
  "", "One more line after a gap.", "The end.",
].join("\n");
const NAMES = ["Aliza", "Rubab", "Sol"];

test("a draft with 3 mentions over 10 lines becomes one paragraph with three chips, and comes back as the same text", () => {
  const ranges = tokenRanges(DRAFT, [], NAMES);
  const d = chatDoc(DRAFT, ranges);
  schema.nodeFromJSON(d).check();
  assert.deepEqual((d.content![0]!.content ?? []).filter((n) => n.type === "chip").map((n) => n.attrs!["text"]), ["@Aliza", "@Rubab", "@Sol"]);
  assert.equal(chatText(d), DRAFT);
  assert.equal(chatText(chatDoc("", [])), "");
  assert.equal(chatText(chatDoc("a\n\nb", [])), "a\n\nb", "empty lines stay");
});

test("a character offset and a document position map both ways, across text, line breaks and chips", () => {
  const text = "hi @Aliza there\nnext";
  const d = chatDoc(text, tokenRanges(text, [], NAMES));
  // paragraph start is 1; "hi " is 3 chars, the chip is one position for 6 characters
  assert.equal(offsetToPos(d, 0), 1);
  assert.equal(offsetToPos(d, 3), 4, "just before the chip");
  assert.equal(offsetToPos(d, 9), 5, "just after the chip");
  assert.equal(offsetToPos(d, 6), 5, "inside the chip lands after it");
  for (let o = 0; o <= text.length; o++) {
    const back = posToOffset(d, offsetToPos(d, o));
    if (o > 3 && o < 9) assert.equal(back, 9, "inside a chip is after it");
    else assert.equal(back, o, `offset ${o} round trips`);
  }
});

test("the field leaves a document alone when it already holds the same words and chips", () => {
  const text = "hi @Aliza";
  const ranges = tokenRanges(text, [], NAMES);
  assert.ok(sameDoc(chatDoc(text, ranges), chatDoc(text, ranges)));
  assert.ok(!sameDoc(chatDoc(text, ranges), chatDoc(text, [])), "a mention that is a chip and one that is plain text differ");
  assert.ok(!sameDoc(chatDoc("a", []), chatDoc("b", [])));
});

test("a paste is plain text: lines become hard breaks, no marks", () => {
  assert.deepEqual(pasteNodes("one\r\ntwo\n\nthree"), [
    { type: "text", text: "one" }, { type: "hardBreak" }, { type: "text", text: "two" }, { type: "hardBreak" }, { type: "hardBreak" }, { type: "text", text: "three" },
  ]);
  assert.deepEqual(pasteNodes(""), []);
});

test("a mention that stops being one (a letter typed after it) is plain text again", () => {
  const was = tokenRanges("@Aliza", [], NAMES);
  const now = tokenRanges("@Alizan", [], NAMES);
  assert.equal(was.length, 1);
  assert.equal(now.length, 0);
  assert.deepEqual((chatDoc("@Alizan", now).content![0]!.content ?? []).map((n) => n.type), ["text"]);
});
