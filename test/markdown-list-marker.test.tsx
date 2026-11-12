// A numbered list in a reply keeps each number on one line: the marker column is as wide as the widest number in the list, so item 100 and up read "100." and do not break into "10" over "0." (gate walk, 12 Nov 2026,
// a 150-line reply). A short list keeps the narrow column.
import test from "node:test";
import assert from "node:assert/strict";
import { listMarkerWidth } from "../ui/src/stream/Markdown.tsx";

test("the marker column grows with the widest number of an ordered list", () => {
  assert.equal(listMarkerWidth("ul", 1, 200), 22, "bullets stay narrow");
  assert.equal(listMarkerWidth("ol", 1, 9), 22, "1 to 9 keeps the narrow column");
  const two = listMarkerWidth("ol", 1, 40);
  const three = listMarkerWidth("ol", 1, 150);
  const four = listMarkerWidth("ol", 990, 20);
  assert.ok(two >= 26, `"40." needs about 26 px, got ${two}`);
  assert.ok(three >= 36, `"150." needs about 36 px, got ${three}`);
  assert.ok(four > three, `a list that reaches 1000 is wider still (${four})`);
  assert.ok(listMarkerWidth("ol", 5, 3) === 22, "a list that starts at 5 and has 3 items ends at 7");
});
