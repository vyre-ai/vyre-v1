// The deck's round trip: three slides with a text box, a filled rectangle, a table and a picture; change one word; only that slide's XML differs and every other part is the same bytes.
import test from "node:test";
import assert from "node:assert/strict";
import { makePptx, unzip } from "./viewer-fixtures.ts";
import { deckAsText, readPptx, setParaRuns, writePptx } from "../../../ui/src/Viewer/rich/pptx.ts";

test("a deck is read as slides with shapes, a fill, a table and a picture at the file's own places", () => {
  const m = readPptx(unzip(makePptx()));
  assert.deepEqual([m.w, m.h, m.slides.length], [9144000, 5143500, 3]);
  const s2 = m.slides[1]!;
  assert.equal(s2.shapes.find((s) => s.fill)?.fill, "#4F81BD");
  assert.deepEqual(
    s2.shapes[1]!.paras.map((p) => p.text).filter((t) => t !== ""),
    ["Revenue grew in every region", "Costs stayed flat", "Hiring starts in January"],
  );
  const s3 = m.slides[2]!;
  assert.equal(s3.shapes.find((s) => s.kind === "table")!.table![1]![1]![0]!.text, "12 percent");
  assert.equal(s3.shapes.find((s) => s.kind === "pic")!.pic!.path, "ppt/media/image1.png");
  assert.match(deckAsText(m), /# Slide 2\nHighlights\nRevenue grew in every region/);
});

test("change one word on one slide: only that slide's XML is rewritten, everything else is byte for byte", () => {
  const entries = unzip(makePptx());
  const m = readPptx(entries);
  const s = m.slides[1]!;
  const p = s.shapes[1]!.paras.find((q) => q.text === "Costs stayed flat")!;
  setParaRuns(s, p, ["Costs fell slightly"]);
  const out = writePptx(m);
  for (const k of Object.keys(entries)) if (k !== "ppt/slides/slide2.xml") assert.deepEqual(out[k], entries[k], k);
  const before = new TextDecoder().decode(entries["ppt/slides/slide2.xml"]!);
  const after = new TextDecoder().decode(out["ppt/slides/slide2.xml"]!);
  assert.equal(after, before.replace("Costs stayed flat", "Costs fell slightly"));
  assert.match(deckAsText(readPptx(out)), /Costs fell slightly/);
});
