// ui/MoreRow: the count, Show less when open, the marks of what is hidden, and its keys.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { MoreRow, moreKey, moreLabel } from "./index.tsx";

test("it reads N more when closed and Show less when open, and names what it holds for a screen reader", () => {
  assert.equal(moreLabel(4, false), "4 more");
  assert.equal(moreLabel(4, true), "Show less");
  const closed = renderToStaticMarkup(<MoreRow count={4} open={false} onToggle={() => {}} what="channels" />);
  assert.match(closed, />4 more</);
  assert.match(closed, /aria-label="4 more channels"/);
  const open = renderToStaticMarkup(<MoreRow count={4} open onToggle={() => {}} what="channels" />);
  assert.match(open, />Show less</);
  assert.match(open, /aria-label="Show fewer channels"/);
});

test("what the hidden rows carry shows while closed and goes when open", () => {
  const marks = <i data-testid="hidden-mark">!</i>;
  assert.match(
    renderToStaticMarkup(<MoreRow count={2} open={false} onToggle={() => {}} marks={marks} />),
    /hidden-mark/,
  );
  assert.doesNotMatch(
    renderToStaticMarkup(<MoreRow count={2} open onToggle={() => {}} marks={marks} />),
    /hidden-mark/,
  );
});

test("Enter and Right open it; Left closes it; Enter on an open one closes it; other keys are not its", () => {
  assert.equal(moreKey("Enter", false), "open");
  assert.equal(moreKey("ArrowRight", false), "open");
  assert.equal(moreKey("ArrowLeft", true), "close");
  assert.equal(moreKey("Enter", true), "close");
  assert.equal(moreKey("ArrowLeft", false), null);
  assert.equal(moreKey("ArrowRight", true), null);
  assert.equal(moreKey("a", false), null);
});
