// The /btw card: one quiet line (lock, question, Keep, close), no ASIDE word, floats over the foot of the transcript without a height of its own, the newest /btw replaces the one before,
// and Esc closes it.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { find, flush, installDom, mount, press } from "../../../../../../ui/src/testing/dom.ts";
import { ConversationDataProvider } from "./data.tsx";
import { AsideList } from "./Aside.tsx";
import { createSample } from "./sample.ts";

const items = [{ id: "ath_1", question: "what is the deadline" }, { id: "ath_2", question: "and the budget" }];
// the saved answer is there at once, so the card settles and no timer keeps the test process alive
const wrap = (children: React.ReactElement, s = createSample("idle")): React.ReactElement => (
  <ConversationDataProvider value={{ ...s.data, call: (async () => ({ messages: [{ author: { kind: "agent" }, body: "Friday." }] })) as never }}>{children}</ConversationDataProvider>
);

test("the card is one header line: a lock that says only you see this, the question, and a close; no ASIDE word", () => {
  const out = renderToStaticMarkup(wrap(<AsideList items={[items[0]!]} onDismiss={() => undefined} />)).replaceAll("<!-- -->", "");
  assert.match(out, /data-testid="aside-lock-ath_1"/);
  assert.match(out, /title="Only you see this"/);
  assert.match(out, /aria-label="Only you see this"/);
  assert.match(out, /data-testid="aside-question-ath_1"[^>]*>what is the deadline</);
  assert.match(out, /data-testid="aside-dismiss-ath_1"/);
  assert.doesNotMatch(out, />Aside</i, "the word ASIDE is gone");
  assert.doesNotMatch(out, /does not\./, "no explanatory sentence");
});

test("a new /btw replaces the one before: only the newest card is drawn, and the older one is put away", async () => {
  const restore = installDom();
  try {
    const dismissed: string[] = [];
    const root = await mount(createRoot, wrap(<AsideList items={items} onDismiss={(id) => dismissed.push(id)} />));
    await flush();
    assert.ok(find(root, "aside-question-ath_2"), "the newest is shown");
    assert.equal(find(root, "aside-question-ath_1"), null, "the older one is not");
    assert.deepEqual(dismissed, ["ath_1"]);
  } finally { restore(); }
});

test("Esc closes the card and the close button closes it too", async () => {
  const restore = installDom();
  const doc = (globalThis as { document: { addEventListener: (t: string, f: (e: unknown) => void) => void; removeEventListener: () => void } }).document;
  const handlers: ((e: unknown) => void)[] = [];
  doc.addEventListener = (_t, f) => { handlers.push(f); };
  doc.removeEventListener = () => undefined;
  try {
    const gone: string[] = [];
    const root = await mount(createRoot, wrap(<AsideList items={[items[0]!]} onDismiss={(id) => gone.push(id)} />));
    await flush();
    await act(async () => { for (const h of handlers) h({ key: "Escape" }); await new Promise((r) => setTimeout(r, 220)); });
    assert.deepEqual(gone, ["ath_1"], "Esc closes it");
    gone.length = 0;
    await press(find(root, "aside-dismiss-ath_1"));
    await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
    assert.deepEqual(gone, ["ath_1"], "the close button closes it");
  } finally { restore(); }
});

test("a kept answer is quiet markdown, not a box: the bold is drawn bold, the time sits in the header, and a long one folds", async () => {
  const { KeptAside, needsFold } = await import("./KeptAside.tsx");
  const short = renderToStaticMarkup(<KeptAside id="m1" question="what is the deadline" body={"**Friday** is the deadline.\n\n1. Draft\n2. Review"} time="9:41" />).replaceAll("<!-- -->", "");
  assert.doesNotMatch(short, /\*\*Friday\*\*/, "no raw markdown");
  assert.match(short, /Friday/);
  assert.match(short, /what is the deadline/);
  assert.match(short, /9:41/);
  assert.doesNotMatch(short, /kept-aside-fold/, "a short answer has no fold");
  const longBody = "A long answer. ".repeat(80);
  assert.ok(needsFold(longBody) && !needsFold("short"));
  const long = renderToStaticMarkup(<KeptAside id="m2" question="q" body={longBody} time="9:42" />);
  assert.match(long, /kept-aside-fold-m2/);
  assert.match(long, /Show more/);
});
