// A step's mark says whose it is: no Vyre-owned step wears an outside app's logo (the spreadsheet steps wore Google's), every outside app's step wears its app's, and a card's title keeps its room at the
// default card width for the longest title a card shows (the chip sits under the title, not beside it).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { brandForStep } from "./brand.ts";
import { CARD_W, STEP_PALETTE } from "./model.ts";

const registry = JSON.parse(
  readFileSync(new URL("../../../../../../generated/registry.json", import.meta.url), "utf8"),
) as {
  steps: { key: string; title: string }[];
};
const OUTSIDE = /^(google\.|ms\.|github\.)/;

test("no Vyre-owned step carries an outside app's mark, and every outside app's step carries one", () => {
  for (const s of registry.steps) {
    if (s.key === "connector_request") continue; // wears the mark of the connector it is given
    const brand = brandForStep(s.key);
    if (OUTSIDE.test(s.key)) assert.notEqual(brand, null, `${s.key} has no app mark`);
    else assert.equal(brand, null, `${s.key} is Vyre's own and wears ${brand}`);
  }
});

test("the title of a card keeps its room at the default width, with the warning mark and the chip on the second line", () => {
  // paddings 10 + 8, logo 28, two gaps of 10, the warning mark 14, a gap 10: what is left of CARD_W is the title's; 13px type is about 7px a letter
  const room = CARD_W - 10 - 8 - 28 - 10 - 10 - 14 - 10;
  for (const p of STEP_PALETTE)
    assert.ok(p.title.length * 7 <= room, `"${p.title}" would be cut (${p.title.length * 7}px of ${room}px)`);
});
