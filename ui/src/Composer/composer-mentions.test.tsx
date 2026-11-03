// The @mention wash on a long draft (owner report, rc.20 on MLA: boxes sat on "able to" and "t on CX" instead of @Aliza and @Rubab, and slid as lines were added). Two causes had to go: the wash never followed
// the field's scroll (React Native Web's onScroll carries no contentOffset), and nothing proved the wash and the field hold the same text, so a box lands on the word it names.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "test-renderer";
import { installDom, mount, find } from "../testing/dom.ts";
import type { Node } from "../testing/dom.ts";
import { Composer, scrollTopOf, tokenRanges } from "./index.tsx";
import type { ComposerLists } from "./index.tsx";

const lists: ComposerLists = { agents: [{ t: "Aliza Cohen", ref: "agt_aliza", kind: "Agent" }, { t: "Rubab Khan", ref: "agt_rubab", kind: "Agent" }, { t: "Sol", ref: "agt_sol", kind: "Agent" }], people: [] };
const NAMES = ["Aliza Cohen", "Rubab Khan", "Sol"];

/** Ten lines, three mentions, each line long enough to wrap in a narrow field. */
const LINES = [
  "Kickoff notes for the Meier file, written the morning after the call so nothing is lost.",
  "@Aliza please confirm that the engagement letter went out and that the client was able to sign it on the first try.",
  "The retainer is paid, the intake form is complete, and the conflict check came back clean.",
  "Two open questions remain about the trust schedule and who holds the originals.",
  "@Rubab can you check the numbers on CX before the Thursday review, and tell us what is still missing.",
  "I will draft the cover note tonight and send it for a read before it goes anywhere.",
  "Nothing here goes to the client until someone has seen the final version in full.",
  "The calendar hold for Friday stays until the court confirms the new date for the hearing.",
  "@Sol keep an eye on the filing portal over the weekend and post anything that changes.",
  "Thanks all, this is the last note for today.",
];
const DRAFT = LINES.join("\n");

test("a draft with 3 mentions over 10 lines: each range names its own word, at its own line", () => {
  const ranges = tokenRanges(DRAFT, [], NAMES).filter((r) => r.kind === "mention");
  assert.deepEqual(ranges.map((r) => DRAFT.slice(r.start, r.end)), ["@Aliza", "@Rubab", "@Sol"]);
  const lineOf = (at: number): number => DRAFT.slice(0, at).split("\n").length;
  assert.deepEqual(ranges.map((r) => lineOf(r.start)), [2, 5, 9]);
  // wrapping never moves an offset: a range is a place in the text, not on the screen
  const wrapped = DRAFT.replace(/ /g, "  ");
  const again = tokenRanges(wrapped, [], NAMES).filter((r) => r.kind === "mention");
  assert.deepEqual(again.map((r) => wrapped.slice(r.start, r.end)), ["@Aliza", "@Rubab", "@Sol"]);
});

test("the wash holds exactly the field's text, so a box sits on the word it names however the lines wrap", () => {
  const html = renderToStaticMarkup(<Composer whoWillAnswer="" lists={lists} value={DRAFT} sendsOutside recipients={null} />);
  const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
  const marks = [...clean(html).matchAll(/data-testid="composer-token-mention"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(marks, ["@Aliza", "@Rubab", "@Sol"], "three boxes, on the three names");
  // the wash's whole text, boxes and the plain text between them, is the draft
  const wash = clean(html.slice(html.indexOf('data-testid="composer-tokens"')));
  const text = wash.slice(wash.indexOf(">") + 1, wash.indexOf("</div></div>")).replace(/<[^>]*>/g, "").replace(/​/g, "");
  assert.equal(text, DRAFT);
});

test("scrollTopOf reads the textarea's scrollTop from the DOM event, which has no contentOffset", () => {
  assert.equal(scrollTopOf({ nativeEvent: { target: { scrollTop: 66 } } }), 66);
  assert.equal(scrollTopOf({ target: { scrollTop: 44 }, nativeEvent: {} }), 44);
  assert.equal(scrollTopOf({ currentTarget: { scrollTop: 22 }, target: { scrollTop: 0 }, nativeEvent: {} }), 22);
  assert.equal(scrollTopOf({ nativeEvent: { contentOffset: { y: 110 } } }), 110, "a native event keeps working");
  assert.equal(scrollTopOf({ nativeEvent: {} }), 0);
  assert.equal(scrollTopOf(null), 0);
  assert.equal(scrollTopOf({ target: { scrollTop: -5 } }), 0, "an overscroll bounce is not a negative offset");
});

test("after the field scrolls, the wash scrolls with it", async () => {
  const restore = installDom();
  try {
    const { act } = await import("react");
    const root = await mount(createRoot, <Composer whoWillAnswer="" lists={lists} value={DRAFT} sendsOutside recipients={null} />);
    const washY = (): string => { const p = (find(root, "composer-tokens") as Node).props; return JSON.stringify({ s: p.style, c: p.className, k: Object.keys(p) }); };
    assert.ok(find(root, "composer-tokens"), "the wash is drawn");
    const before = washY();
    const field = find(root, "composer-field")!;
    await act(async () => { (field.props.onScroll as (e: unknown) => void)({ nativeEvent: { target: { scrollTop: 66 } }, target: { scrollTop: 66 }, currentTarget: { scrollTop: 66 } }); });
    const after = washY();
    assert.notEqual(after, before, "the wash moved");
    assert.match(after, /-66/, "by the field's scrollTop");
    await act(async () => { (field.props.onScroll as (e: unknown) => void)({ nativeEvent: { target: { scrollTop: 0 } }, target: { scrollTop: 0 } }); });
    assert.equal(washY(), before, "and back");
  } finally { restore(); }
});
