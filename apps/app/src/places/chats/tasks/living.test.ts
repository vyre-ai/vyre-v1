// @tsx
// The alive line and the Still need these card (lane r42-alive): the words are built from counts, never a zero, and say which day the line reaches back to.
import test from "node:test";
import assert from "node:assert/strict";
import { aliveWords, sinceWords, StillRow } from "./Living.tsx";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const NOW = Date.UTC(2026, 10, 19, 10);
const DAY = 86_400_000;

test("the alive line names only what happened", () => {
  const items = (n: number) => Array.from({ length: n }, () => ({})) as never;
  assert.equal(aliveWords({ items: items(3), fresh: 2 }), "3 put away, 2 new for you");
  assert.equal(aliveWords({ items: items(1), fresh: 0 }), "1 put away");
  assert.equal(aliveWords({ items: items(0), fresh: 4 }), "4 new for you");
  assert.equal(aliveWords({ items: items(0), fresh: 0 }), "");
});

test("it says which day it reaches back to", () => {
  assert.equal(sinceWords(NOW - 2 * 3_600_000, NOW), "Since this morning");
  assert.match(sinceWords(NOW - 3 * DAY, NOW), /^Since (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d+ \w{3}$/);
});

const row = (lookDone?: { threadId: string; quote?: string; by?: string; at?: number }) =>
  ({
    task: { id: "tsk_1", title: "Book the venue" },
    why: "Might be finished.",
    askedAt: NOW,
    ...(lookDone ? { lookDone } : {}),
  }) as never;
const html = (item: unknown): string =>
  renderToStaticMarkup(
    createElement(StillRow, {
      item: item as never,
      nameOf: (id: string) => (id === "usr_sara" ? "Sara" : id),
      openTask: () => undefined,
      openChat: () => undefined,
      answer: () => undefined,
    }),
  );

test("a looks-done row for a reader who cannot read the chat shows no quote and no Done, only Open the chat and Not yet", () => {
  const h = html(row({ threadId: "thr_1" }));
  assert.match(h, /Looks done/);
  assert.match(h, /Open the chat to see why/);
  assert.match(h, /Open the chat/);
  assert.match(h, /Not yet/);
  assert.doesNotMatch(h, /Payment received/);
  assert.doesNotMatch(h, /data-testid="still-done"/, "no Done on words they cannot see");
  assert.match(h, /data-testid="still-open-chat"|still-open-chat/);
});

test("with the quote the row shows the words, who wrote them, the date, and Done; a plain ask row has Keep and Archive and never the lead-in", () => {
  const h = html(
    row({ threadId: "thr_1", quote: "Payment received, $171.56", by: "usr_sara", at: Date.UTC(2026, 10, 17, 9) }),
  );
  assert.match(h, /Payment received, \$171\.56/);
  assert.match(h, /Sara/);
  assert.match(h, /still-done/);
  const plain = html(row());
  assert.match(plain, /Might be finished\./);
  assert.doesNotMatch(plain, /Looks done/);
  assert.match(plain, /still-archive/);
});
