// RowActions: a row's quick actions show on hover or focus, not at rest; the sheet that does it is in the Row stylesheet.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { RowActions } from "./index.tsx";

test("RowActions keeps its children in the page (so a keyboard and a test can reach them) under a hover class", () => {
  const html = renderToStaticMarkup(
    <RowActions>
      <button data-testid="go">Allow</button>
    </RowActions>,
  );
  assert.match(html, /class="vyre-hover-act"/);
  assert.ok(html.includes('data-testid="go"'));
});

test("the stylesheet hides them at rest and shows them on row hover, on focus inside, and always on a touch screen", () => {
  const src = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");
  assert.match(src, /\.vyre-row \.vyre-hover-act\{opacity:0\}/);
  assert.match(src, /\.vyre-row:hover \.vyre-hover-act,\.vyre-row:focus-within \.vyre-hover-act\{opacity:1\}/);
  assert.match(src, /@media \(hover:none\)\{\.vyre-row \.vyre-hover-act\{opacity:1\}\}/);
});
