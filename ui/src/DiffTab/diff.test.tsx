// ui/DiffTab: word marks, paragraph diff for docx and md, revert of one change, the keys (j k n p Cmd-Enter), unified and split, images, inline comments with @.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  COMMENT_CAPABILITY,
  DIFF_KEYS,
  DiffTab,
  ImageDiff,
  MAX_CELLS,
  REVERT_CAPABILITY,
  bodyParts,
  changeList,
  clampPercent,
  commentAnchor,
  commentInput,
  commentsFor,
  countsLabel,
  diffKeyAction,
  frozenDiffTabProps,
  linesOf,
  mentionsOf,
  moveChange,
  moveFile,
  paragraphRows,
  paragraphsOf,
  revertInput,
  sameWords,
  sliderKey,
  splitRows,
  tokens,
  unifiedLines,
  withoutChange,
  wordMarks,
} from "./index.tsx";
import type { DiffFile, DiffHunk } from "./index.tsx";

const H = (id: string, removed: string, added: string, context = "Role"): DiffHunk => ({ id, context, removed, added });

const FILES: readonly DiffFile[] = [
  { path: "AGENT.md", added: 3, removed: 2, body: "paragraph", hunks: [H("h1", "Intake answers.", "Intake answers first."), H("h2", "Old tone line\nsecond", "New tone line")] },
  { path: "agent.toml", added: 1, removed: 1, body: "text", hunks: [H("h3", 'model = "a"', 'model = "b"', "Model")] },
  { path: "notes/empty.md", added: 0, removed: 0, body: "text", hunks: [] },
];

const text = (html: string): string => html.replace(/<[^>]+>/g, "");

test("tokens keep every character: joining them gives the text back", () => {
  for (const sample of ["Intake answers first.", "  leading and  double  spaces ", "", "one", "a\tb\nc"]) {
    assert.equal(tokens(sample).join(""), sample);
  }
});

test("word marks: only the changed words are marked, on both sides", () => {
  const marks = wordMarks("one two three", "one three four");
  assert.deepEqual(marks.removed, [{ text: "one ", kind: "same" }, { text: "two ", kind: "del" }, { text: "three", kind: "same" }]);
  assert.deepEqual(marks.added, [{ text: "one three", kind: "same" }, { text: " four", kind: "add" }]);
  assert.equal(marks.removed.map((s) => s.text).join(""), "one two three", "the removed side reads as the old text");
  assert.equal(marks.added.map((s) => s.text).join(""), "one three four", "the added side reads as the new text");
});

test("word marks on the frozen hunk: the shared start stays unmarked", () => {
  const marks = wordMarks("Intake answers.", "Intake answers first.");
  assert.deepEqual(marks.removed, [{ text: "Intake ", kind: "same" }, { text: "answers.", kind: "del" }]);
  assert.deepEqual(marks.added, [{ text: "Intake ", kind: "same" }, { text: "answers first.", kind: "add" }]);
});

test("identical text has no marks, and a whitespace-only change is not a change of words", () => {
  const same = wordMarks("same text", "same text");
  assert.deepEqual(same.removed, [{ text: "same text", kind: "same" }]);
  assert.deepEqual(same.added, [{ text: "same text", kind: "same" }]);
  assert.equal(sameWords("a  b", "a b"), true);
  assert.equal(sameWords("a b", "a c"), false);
  const lines = unifiedLines(H("x", "a  b", "a b"), true);
  assert.equal(lines.every((l) => l.segments === undefined), true, "no marks for whitespace only");
});

test("a very long pair is marked whole instead of building a huge table", () => {
  const big = Array.from({ length: Math.ceil(Math.sqrt(MAX_CELLS)) + 50 }, (_, i) => `w${i}`).join(" ");
  const marks = wordMarks(big, `${big} extra`);
  assert.deepEqual(marks.removed, [{ text: big, kind: "del" }]);
  assert.equal(marks.added[0]?.kind, "add");
});

test("unified lines list removed lines then added lines; paired lines carry word marks", () => {
  const lines = unifiedLines(H("m", "keep this\nonly old", "keep that"), true);
  assert.deepEqual(lines.map((l) => l.sign), ["-", "-", "+"]);
  assert.equal(lines[0]?.segments?.some((s) => s.kind === "del"), true, "the first removed line pairs with the added line");
  assert.equal(lines[1]?.segments, undefined, "an unpaired removed line has no marks");
  assert.equal(lines[2]?.segments?.some((s) => s.kind === "add"), true);
  const off = unifiedLines(H("m", "keep this", "keep that"), false);
  assert.equal(off.every((l) => l.segments === undefined), true, "marks off: plain lines");
  assert.deepEqual(unifiedLines(H("e", "", ""), true), []);
  assert.deepEqual(linesOf(""), []);
});

test("split rows put the removed line on the left and the added line on the right", () => {
  const rows = splitRows(H("s", "a\nb\nc", "A"), true);
  assert.equal(rows.length, 3);
  assert.equal(rows[0]?.left?.text, "a");
  assert.equal(rows[0]?.right?.text, "A");
  assert.equal(rows[1]?.right, null, "no added line at that place");
  assert.equal(rows[2]?.left?.sign, "-");
  assert.equal(splitRows(H("n", "", "x"), true)[0]?.left, null, "a pure addition has an empty left side");
});

test("paragraph diff for docx and md: paragraphs, not lines, with word marks inside a changed paragraph", () => {
  assert.deepEqual(paragraphsOf("First para.\nstill first.\n\n\nSecond para.\n"), ["First para.\nstill first.", "Second para."]);
  const rows = paragraphRows(H("p", "First para.\n\nSecond para here.", "First para.\n\nSecond para there.\n\nThird."), true);
  assert.deepEqual(rows.map((r) => r.kind), ["removed", "removed", "added", "added", "added"]);
  const secondRemoved = rows[1];
  assert.ok(secondRemoved !== undefined);
  assert.deepEqual(secondRemoved.segments.map((s) => `${s.kind}:${s.text}`), ["same:Second para ", "del:here."]);
  const firstRemoved = rows[0];
  assert.deepEqual(firstRemoved?.segments, [{ text: "First para.", kind: "same" }], "an unchanged paragraph pair is not marked");
  const third = rows[4];
  assert.deepEqual(third?.segments, [{ text: "Third.", kind: "same" }], "a new paragraph with no partner is shown whole");
  const plain = paragraphRows(H("p", "a b", "a c"), false);
  assert.deepEqual(plain.map((r) => r.segments.length), [1, 1], "marks off");
});

test("revert one change: the hunk goes, the counts follow, other files and hunks stay", () => {
  const after = withoutChange(FILES, "AGENT.md", "h2");
  const agent = after.find((f) => f.path === "AGENT.md");
  assert.deepEqual(agent?.hunks.map((h) => h.id), ["h1"]);
  assert.equal(agent?.added, 2, "h2 added one line");
  assert.equal(agent?.removed, 0, "h2 removed two lines");
  assert.equal(after.find((f) => f.path === "agent.toml")?.hunks.length, 1);
  assert.equal(withoutChange(FILES, "AGENT.md", "missing")[0], FILES[0], "an unknown hunk changes nothing");
  assert.deepEqual(withoutChange(FILES, "AGENT.md", "missing").map((f) => f.hunks.length), [2, 1, 0]);
  const last = withoutChange(withoutChange(FILES, "agent.toml", "h3"), "agent.toml", "h3");
  assert.equal(last.find((f) => f.path === "agent.toml")?.hunks.length, 0, "reverting twice is harmless");
  assert.deepEqual(revertInput("cs_1", "AGENT.md", "h2"), { changesetId: "cs_1", path: "AGENT.md", hunkId: "h2" });
  assert.equal(REVERT_CAPABILITY, "changesets.revert_change");
});

test("keys: j and k move files, n and p move changes across files, Cmd-Enter reverts, typing in a field does nothing", () => {
  assert.deepEqual([...DIFF_KEYS], ["j", "k", "n", "p", "Cmd-Enter"]);
  assert.equal(diffKeyAction({ key: "j" }, false), "next-file");
  assert.equal(diffKeyAction({ key: "k" }, false), "prev-file");
  assert.equal(diffKeyAction({ key: "n" }, false), "next-change");
  assert.equal(diffKeyAction({ key: "p" }, false), "prev-change");
  assert.equal(diffKeyAction({ key: "Enter", metaKey: true }, false), "revert");
  assert.equal(diffKeyAction({ key: "Enter", ctrlKey: true }, false), "revert");
  assert.equal(diffKeyAction({ key: "Enter" }, false), null, "plain Enter does not revert");
  assert.equal(diffKeyAction({ key: "j", metaKey: true }, false), null, "Cmd-J belongs to Ask");
  assert.equal(diffKeyAction({ key: "j" }, true), null, "typing a comment never moves files");
  assert.equal(diffKeyAction({ key: "Enter", metaKey: true }, true), null, "Cmd-Enter in a field never reverts");
  assert.equal(diffKeyAction({ key: "x" }, false), null);
  assert.equal(moveFile(FILES, "AGENT.md", "j"), "agent.toml");
  assert.equal(moveFile(FILES, "agent.toml", "k"), "AGENT.md");
  assert.equal(moveFile(FILES, "AGENT.md", "k"), "AGENT.md", "stops at the top");
  assert.equal(moveFile(FILES, "notes/empty.md", "j"), "notes/empty.md", "stops at the bottom");
  assert.equal(moveFile(FILES, null, "j"), "AGENT.md");
  assert.equal(moveFile([], null, "j"), null);
  const changes = changeList(FILES);
  assert.deepEqual(changes.map((c) => `${c.path}:${c.hunkId}`), ["AGENT.md:h1", "AGENT.md:h2", "agent.toml:h3"]);
  assert.deepEqual(moveChange(changes, null, "n"), changes[0]);
  assert.deepEqual(moveChange(changes, null, "p"), changes[2]);
  assert.deepEqual(moveChange(changes, changes[1] ?? null, "n"), changes[2], "n crosses into the next file");
  assert.deepEqual(moveChange(changes, changes[2] ?? null, "p"), changes[1]);
  assert.deepEqual(moveChange(changes, changes[2] ?? null, "n"), changes[2], "stops at the last change");
  assert.equal(moveChange([], null, "n"), null);
});

test("@ people and agents in a comment are found once each and split out for colouring", () => {
  assert.deepEqual(mentionsOf("@Omar please check, @Intake too. @Omar again"), ["Omar", "Intake"]);
  assert.deepEqual(mentionsOf("thanks @Maya."), ["Maya"], "a full stop after a name is not part of it");
  assert.deepEqual(mentionsOf("(@Docs) and \"@Scout\""), ["Docs", "Scout"]);
  assert.deepEqual(mentionsOf("no one here, mail a@b.com"), []);
  assert.deepEqual(bodyParts("Ask @Intake to fix it"), [{ text: "Ask ", mention: false }, { text: "@Intake", mention: true }, { text: " to fix it", mention: false }]);
  assert.deepEqual(bodyParts("plain"), [{ text: "plain", mention: false }]);
  assert.deepEqual(bodyParts(""), []);
});

test("a comment is added through changesets.comments.add with its anchor and mentions", () => {
  const hunk = H("h1", "old", "A long replacement line ".repeat(10));
  const anchor = commentAnchor("AGENT.md", hunk);
  assert.equal(anchor.kind, "range");
  assert.equal(anchor.path, "AGENT.md");
  assert.ok(anchor.quote.length <= 120);
  assert.equal(commentAnchor("a", H("r", "only removed text", "")).quote, "only removed text");
  const input = commentInput("cs_1", "AGENT.md", hunk, "@Intake keep this");
  assert.equal(input["changesetId"], "cs_1");
  assert.deepEqual(input["mentions"], ["Intake"]);
  assert.equal(input["text"], "@Intake keep this");
  assert.equal("mentions" in commentInput("cs_1", "AGENT.md", hunk, "no mention"), false);
  assert.equal(COMMENT_CAPABILITY, "changesets.comments.add");
  assert.deepEqual(commentsFor(frozenDiffTabProps.comments, "hunk_1").map((c) => c.id), ["cmt_1"]);
  assert.deepEqual(commentsFor(frozenDiffTabProps.comments, "other"), []);
});

test("counts, slider keys and percent clamp", () => {
  assert.equal(countsLabel({ added: 2, removed: 1 }), "+2 −1");
  assert.equal(clampPercent(-5), 0);
  assert.equal(clampPercent(140), 100);
  assert.equal(clampPercent(33.4), 33);
  assert.equal(sliderKey(50, "ArrowRight"), 55);
  assert.equal(sliderKey(50, "ArrowLeft"), 45);
  assert.equal(sliderKey(98, "ArrowRight"), 100);
  assert.equal(sliderKey(50, "Home"), 0);
  assert.equal(sliderKey(50, "End"), 100);
  assert.equal(sliderKey(50, "x"), null);
});

test("the tab renders the frozen props: a paragraph diff with its comment, in a labelled region", () => {
  const html = renderToStaticMarkup(<DiffTab {...frozenDiffTabProps} />);
  assert.match(html, /aria-label="Changes to AGENT.md"/);
  assert.match(html, /data-testid="diff-hunk-hunk_1"/);
  assert.match(html, /data-testid="diff-paragraphs"/);
  assert.match(html, /data-testid="diff-para-removed"/);
  assert.match(html, /data-testid="diff-para-added"/);
  assert.match(html, /data-testid="diff-note-cmt_1"/);
  assert.ok(text(html).includes("Keep the shorter line."));
  assert.ok(text(html).includes("Omar"));
  assert.ok(text(html).includes("+2 −1"));
  assert.match(html, /data-keys="j,k,n,p,Cmd-Enter"/);
  assert.doesNotMatch(html, /data-testid="diff-files"/, "one file: no file list");
});

test("a text file is unified by default and split on request; both layouts keep the same signs", () => {
  const files: readonly DiffFile[] = [FILES[1] as DiffFile];
  const unified = renderToStaticMarkup(<DiffTab {...frozenDiffTabProps} files={files} comments={[]} selectedPath="agent.toml" layout="unified" />);
  assert.match(unified, /data-testid="diff-unified"/);
  assert.match(unified, /data-testid="diff-line-del"/);
  assert.match(unified, /data-testid="diff-line-add"/);
  assert.doesNotMatch(unified, /data-testid="diff-split"/);
  const split = renderToStaticMarkup(<DiffTab {...frozenDiffTabProps} files={files} comments={[]} selectedPath="agent.toml" layout="split" />);
  assert.match(split, /data-testid="diff-split-left"/);
  assert.match(split, /data-testid="diff-split-right"/);
  assert.doesNotMatch(split, /data-testid="diff-unified"/);
  assert.ok(text(unified).includes("model = &quot;a&quot;") && text(unified).includes("model = &quot;b&quot;"));
});

test("more than one file shows the file list with counts as shared Rows; the selected file is the quiet wash", () => {
  const html = renderToStaticMarkup(<DiffTab {...frozenDiffTabProps} files={FILES} comments={[]} selectedPath="agent.toml" />);
  assert.match(html, /data-testid="diff-files"/);
  for (const f of FILES) assert.match(html, new RegExp(`data-testid="row-diff-file-${f.path.replace(/[.\\/]/g, "\\$&")}"`));
  assert.match(html, /data-testid="row-diff-file-agent\.toml-trailing"/, "counts sit in the Row's trailing slot");
  assert.match(html, /background-color:var\(--sel\)/);
  assert.doesNotMatch(html, /background-color:var\(--accent\)/);
  assert.ok(text(html).includes("+4 −3"), "the total in the header is the sum of all files");
});

test("a file with no changes says so; the layout and word marks controls are always there", () => {
  const html = renderToStaticMarkup(<DiffTab {...frozenDiffTabProps} files={FILES} comments={[]} selectedPath="notes/empty.md" />);
  assert.match(html, /data-testid="diff-empty"/);
  assert.ok(text(html).includes("No differences"));
  for (const id of ["diff-layout-unified", "diff-layout-split", "diff-wordmarks"]) assert.match(html, new RegExp(`data-testid="${id}"`));
});

test("an image change is a slider by default and two images side by side on request", () => {
  const slider = renderToStaticMarkup(<ImageDiff before="https://x.test/a.png" after="https://x.test/b.png" mode="slider" onMode={() => undefined} />);
  assert.match(slider, /role="slider"/);
  assert.match(slider, /aria-valuenow="50"/);
  assert.match(slider, /data-testid="diff-image-compare"/);
  const side = renderToStaticMarkup(<ImageDiff before="https://x.test/a.png" after="https://x.test/b.png" mode="side" onMode={() => undefined} />);
  assert.doesNotMatch(side, /role="slider"/);
  assert.ok(text(side).includes("Before") && text(side).includes("After"));
});
