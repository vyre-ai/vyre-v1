import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Info, Tip } from "./index.tsx";

test("Tip carries its help as the browser tooltip and leaves the child as it was", () => {
  const out = renderToStaticMarkup(<Tip help="Why it is off"><span id="child">Save</span></Tip>);
  assert.match(out, /title="Why it is off"/);
  assert.match(out, /<span id="child">Save<\/span>/);
  assert.equal(renderToStaticMarkup(<Tip help={undefined}><span id="child">Save</span></Tip>), '<span id="child">Save</span>', "no help, no wrapper");
});

test("Info is a small mark whose tooltip and label are the sentence", () => {
  const out = renderToStaticMarkup(<Info help="It is stored once" testID="i" />);
  assert.match(out, /title="It is stored once"/);
  assert.match(out, /aria-label="It is stored once"/);
  assert.ok(!out.includes(">It is stored once<"), "the sentence is never drawn as text");
});
