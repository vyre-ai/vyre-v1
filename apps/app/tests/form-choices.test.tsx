import test from "node:test";
import assert from "node:assert/strict";
import { choiceRows } from "../src/places/apps/shell/FormChoices.tsx";

test("saved choices come first, marked gone when the publisher can no longer offer them", () => {
  const saved = [{ key: "chc_a", refId: "rec_a", label: "Acme" }, { key: "chc_b", refId: "rec_b", label: "Globex" }];
  const rows = choiceRows(saved, [{ refId: "rec_a", label: "Acme" }, { refId: "rec_c", label: "Initech" }], new Set(["rec_a", "rec_b"]));
  assert.deepEqual(rows, [
    { refId: "rec_a", label: "Acme", picked: true, gone: false },
    { refId: "rec_b", label: "Globex", picked: true, gone: true },
    { refId: "rec_c", label: "Initech", picked: false, gone: false },
  ]);
});
test("a search that hides a saved choice does not drop it from the list", () => {
  const rows = choiceRows([{ key: "chc_a", refId: "rec_a", label: "Acme" }], [], new Set(["rec_a"]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.picked, true);
});
