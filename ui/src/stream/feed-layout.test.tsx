// The feed keeps the end in view when its own height shrinks (a notice line appears under it, the composer grows) while the person is at the end; a person who scrolled up is left where they are.
// react-native-web reports a layout through a ResizeObserver the test renderer has not got, so the rule the layout handler applies is tested on its own, with the end-of-feed measure it reads.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { installDom, flush } from "../testing/dom.ts";
import { Feed, holdsEnd, isAtEnd } from "./Feed.tsx";

test("a feed at its end goes back to the end when its height changes", () => {
  // a 600 px list of 900 px, scrolled to the end, then 26 px shorter (the notice line): the old position is 26 px short of the end, still within the slack of the person's reading position
  assert.equal(isAtEnd(300, 600, 900), true);
  assert.equal(holdsEnd(true, true), true);
});

test("a feed the person scrolled up is not pulled down, and one that does not follow stays put", () => {
  assert.equal(isAtEnd(100, 400, 900), false);
  assert.equal(holdsEnd(true, false), false);
  assert.equal(holdsEnd(false, true), false);
});

test("the person acted (endKey moved): the feed says it is at the end again, so Jump to latest goes away with no scroll event (owner's walk, 15 Nov: it stayed after four sends)", async () => {
  installDom();
  const seen: boolean[] = [];
  const r = createRoot();
  const feed = (key: number) => (
    <Feed endKey={key} onAtEndChange={(v) => seen.push(v)}>
      {null}
    </Feed>
  );
  await act(async () => {
    r.render(feed(0));
  });
  await flush();
  assert.deepEqual(seen, [], "nothing is said while nothing happened");
  await act(async () => {
    r.render(feed(1));
  });
  await flush();
  assert.deepEqual(seen, [true]);
});
