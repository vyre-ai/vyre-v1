// A card's chip never says "error" alone: what is missing in one to three words, "Failed" for a run that failed, "Needs a fix" when only the cause is unknown.
import test from "node:test";
import assert from "node:assert/strict";
import { chipText } from "./chip-words.ts";

test("a step missing its file says Needs a file, not error", () => {
  assert.equal(
    chipText(
      "error",
      [{ nodeId: "n1", severity: "error", message: "Send for signature: choose the file to send for signature." }],
      undefined,
    ),
    "Needs a file",
  );
});

test("the other chips are unchanged, a failed run says Failed, and an unknown cause says Needs a fix", () => {
  assert.equal(chipText("waiting", [], "waiting"), "waiting");
  assert.equal(chipText("tested", [], undefined), "tested");
  assert.equal(chipText("error", [], "failed"), "Failed");
  assert.equal(
    chipText("error", [{ severity: "error", message: "A loop cannot contain another loop." }], undefined),
    "Needs a fix",
  );
  for (const w of [chipText("error", [], "failed"), chipText("error", [], undefined)])
    assert.notEqual(w.toLowerCase(), "error");
});
