// Every ask that destroys something puts focus on its safe button when it opens, so a stray Enter or Space on a keyboard never confirms it (owner rule, 19 Nov 2026). The desktop "Delete this message?"
// is DeleteAsk (delete-ask.test.tsx); this pins the other two asks that are not a ui/Dialog action row: the phone sheet's own "Delete this message?" list and the recording's "Delete this recording?".
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");

test("the phone sheet's delete ask puts focus on Cancel, not on Delete", () => {
  const src = read("./MessageView.tsx");
  assert.match(
    src,
    /row\(\{ label: "Cancel" \}, false, \(\) => setAsking\(false\), true\)/,
    "Cancel is the focused row",
  );
  assert.doesNotMatch(src, /row\(\{ label: "Delete" \}, true, [^)]*\), true\)/, "Delete never takes focus");
  assert.match(src, /\{\.\.\.\(focus \? \{ ref: focusOnMount as never \} : \{\}\)\}/);
});

test("the recording's delete ask puts focus on Cancel, and SheetButton focuses itself only when asked", () => {
  const pop = read("../computer/ComputerPopup.tsx");
  assert.match(pop, /<SheetButton label="Cancel" focus /);
  assert.doesNotMatch(pop, /<SheetButton label="Delete" [^>]*focus/);
  const parts = read("../computer/parts.tsx");
  assert.match(parts, /if \(focus && Platform\.OS === "web"\) self\.current\?\.focus\?\.\(\)/);
});
