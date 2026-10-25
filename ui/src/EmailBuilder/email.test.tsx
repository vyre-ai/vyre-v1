// ui/EmailBuilder: edit, compile, test send, accept one of three suggested diffs (spec 2.19, 3.6). The pure rules (compile, checks, history, focus keys)
// are tested directly; the view is rendered to markup in each mode, focus state and pane tab. Browser behaviour (clicks, typing) is the shots mount and the golden flow.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EmailBuilder, EMAIL_BLOCK_KINDS, EMAIL_MODES, EMAIL_PREVIEWS, PANE_TABS, PREVIEW_TEXT_LIMIT, SUBJECT_LIMIT,
  blocksToPlain, splitTokens, canRedo, canUndo, compileEmail, editBlock, fillMerge, focusKey, mergeFieldsOf, mergeToken, moveBlock, newBlock, pushHistory, runChecks, stepHistory,
} from "./index.tsx";
import type { EmailBlock, EmailBuilderViewProps, EmailDiff, EmailHistory, EmailSnapshot } from "./index.tsx";

const BLOCKS: readonly EmailBlock[] = [
  { id: "t1", kind: "text", text: "Hi, thanks for your time on Friday." },
  { id: "m1", kind: "merge", field: "first_name", text: "there" },
  { id: "b1", kind: "button", text: "Pick a time" },
  { id: "d1", kind: "divider" },
];
const DIFFS: readonly EmailDiff[] = [
  { id: "d-subject", summary: "Shorter subject: Friday follow-up" },
  { id: "d-body", summary: "Tighten the first paragraph" },
  { id: "d-cta", summary: "Change the button to Book 15 minutes" },
];
const base: EmailBuilderViewProps = { id: "em1", title: "Q4 follow-up", subject: "Following up on our Friday call", previewText: "Two times that work this week", mode: "visual", blocks: BLOCKS, diffs: DIFFS };

const tag = (html: string, id: string): string => {
  const m = new RegExp(`<[^>]*data-testid="${id}"[^>]*>`).exec(html);
  assert.ok(m !== null, `${id} is rendered`);
  return m[0];
};

test("edit: a block edit changes the compiled HTML and the plain-text part", () => {
  const next = editBlock(BLOCKS, "t1", { text: "Hello, thanks for Friday." });
  assert.match(compileEmail(next), /Hello, thanks for Friday\./);
  assert.doesNotMatch(compileEmail(next), /thanks for your time/);
  assert.match(blocksToPlain(next), /^Hello, thanks for Friday\./);
  assert.equal(BLOCKS[0]?.text, "Hi, thanks for your time on Friday.", "the source blocks are not changed");
});

test("compile: send keeps merge tokens, preview fills them from the record, escapes text, ends with an unsubscribe link", () => {
  const withTok: readonly EmailBlock[] = [{ id: "t", kind: "text", text: "Hi {{first_name|there}} <b>" }];
  assert.match(compileEmail(withTok, { mode: "send" }), /Hi \{\{first_name\|there\}\} &lt;b&gt;/);
  assert.match(compileEmail(withTok, { mode: "preview", values: { first_name: "Elena" } }), /Hi Elena &lt;b&gt;/);
  assert.match(compileEmail(withTok, { mode: "preview", values: {} }), /Hi there/);
  assert.match(compileEmail(withTok), /href="#unsubscribe"/);
  assert.match(compileEmail(withTok, { dark: true }), /#121214/);
  assert.equal(fillMerge("{{a}}{{b|x}}", { a: "1" }), "1x");
  assert.equal(mergeToken("first_name", "there"), "{{first_name|there}}");
  assert.deepEqual(mergeFieldsOf("{{first_name|there}} and {{org.name}} and {{first_name}}"), ["first_name", "org.name"]);
});

test("blocks: every kind builds; move, duplicate-safe edit, nested edit and bounds", () => {
  for (const k of EMAIL_BLOCK_KINDS) assert.equal(newBlock(k, `n-${k}`).kind, k);
  assert.equal(newBlock("columns", "c").children?.length, 2);
  assert.deepEqual(moveBlock(BLOCKS, "b1", -1).map((b) => b.id), ["t1", "b1", "m1", "d1"]);
  assert.deepEqual(moveBlock(BLOCKS, "t1", -1).map((b) => b.id), ["t1", "m1", "b1", "d1"], "first block does not move up");
  assert.deepEqual(moveBlock(BLOCKS, "d1", 1).map((b) => b.id), ["t1", "m1", "b1", "d1"], "last block does not move down");
  const cols = [newBlock("columns", "c")];
  assert.equal(editBlock(cols, "c-a", { text: "Edited" })[0]?.children?.[0]?.text, "Edited");
});

test("checks: subject, preview text, plain part and unsubscribe each report a level", () => {
  const html = compileEmail(BLOCKS);
  const ok = runChecks({ subject: "Friday follow-up", previewText: "Two times", html, plain: "Hi\n\nUnsubscribe" });
  assert.deepEqual(ok.map((c) => c.level), ["ok", "ok", "ok", "ok"]);
  const bad = runChecks({ subject: "", previewText: "", html: "<p>x</p>", plain: "" });
  assert.deepEqual(bad.map((c) => [c.id, c.level]), [["subject", "bad"], ["preview", "warn"], ["plain", "bad"], ["unsub", "bad"]]);
  assert.equal(runChecks({ subject: "x".repeat(SUBJECT_LIMIT + 1), previewText: "y".repeat(PREVIEW_TEXT_LIMIT + 1), html, plain: "Unsubscribe" })[0]?.level, "warn");
  assert.equal(runChecks({ subject: "x".repeat(SUBJECT_LIMIT + 1), previewText: "y".repeat(PREVIEW_TEXT_LIMIT + 1), html, plain: "Unsubscribe" })[1]?.level, "warn");
});

test("autosave versions: undo and redo walk the edits and stop at the ends; a new edit drops the redo tail", () => {
  const snap = (subject: string): EmailSnapshot => ({ subject, previewText: "", blocks: [], html: "", plain: "" });
  let h: EmailHistory = { entries: [snap("a")], at: 0 };
  assert.equal(canUndo(h), false);
  h = pushHistory(pushHistory(h, snap("b")), snap("c"));
  assert.equal(h.at, 2);
  assert.equal(canUndo(h), true);
  assert.equal(canRedo(h), false);
  h = stepHistory(h, -1);
  assert.equal(h.entries[h.at]?.subject, "b");
  assert.equal(canRedo(h), true);
  h = pushHistory(h, snap("d"));
  assert.deepEqual(h.entries.map((e) => e.subject), ["a", "b", "d"]);
  assert.equal(stepHistory(stepHistory(stepHistory(h, -1), -1), -1).at, 0);
});

test("focus: Cmd-Shift-F toggles and Escape leaves; other keys are not ours", () => {
  assert.equal(focusKey({ key: "F", metaKey: true, shiftKey: true }, false), true);
  assert.equal(focusKey({ key: "f", ctrlKey: true, shiftKey: true }, true), false);
  assert.equal(focusKey({ key: "Escape" }, true), false);
  assert.equal(focusKey({ key: "Escape" }, false), null);
  assert.equal(focusKey({ key: "f", metaKey: true }, false), null);
});

test("every mode renders its own editor and marks itself on the root", () => {
  for (const mode of EMAIL_MODES) {
    const html = renderToStaticMarkup(<EmailBuilder {...base} mode={mode} html="<p>Hello</p>" plain="Hello" />);
    assert.match(tag(html, "email-builder"), new RegExp(`data-mode="${mode}"`));
    assert.match(tag(html, `em-mode-${mode}`), /aria-selected="true"/);
  }
  const visual = renderToStaticMarkup(<EmailBuilder {...base} mode="visual" />);
  assert.match(visual, /Pick a time/);
  assert.match(visual, /\{\{first_name\|there\}\}/);
  assert.ok(visual.includes('data-testid="em-rail"'), "the block rail shows in Visual");
  const code = renderToStaticMarkup(<EmailBuilder {...base} mode="html" html="<p>Hello</p>" />);
  assert.match(code, /data-testid="em-html"/);
  assert.ok(!code.includes('data-testid="em-rail"'), "no block rail in HTML mode");
  assert.match(renderToStaticMarkup(<EmailBuilder {...base} mode="plain" plain="Plain body" />), /Plain body/);
});

test("focus mode hides the header, envelope, rail and pane and shows the leave hint", () => {
  const html = renderToStaticMarkup(<EmailBuilder {...base} focus />);
  assert.match(tag(html, "email-builder"), /data-focus="true"/);
  for (const id of ["em-head", "em-env", "em-rail", "em-pane"]) assert.ok(!html.includes(`data-testid="${id}"`), `${id} hidden in focus`);
  assert.ok(html.includes('data-testid="em-focus-hint"'));
  const normal = renderToStaticMarkup(<EmailBuilder {...base} />);
  for (const id of ["em-head", "em-env", "em-rail", "em-pane"]) assert.ok(normal.includes(`data-testid="${id}"`), `${id} shown`);
  assert.match(tag(normal, "email-builder"), /data-focus="false"/);
});

test("Ask pane lists the three suggested diffs, each with its own Accept; an accepted one reads Accepted", () => {
  const html = renderToStaticMarkup(<EmailBuilder {...base} askOpen diffs={[...DIFFS.slice(0, 1).map((d) => ({ ...d, accepted: true })), ...DIFFS.slice(1)]} />);
  for (const d of DIFFS) assert.match(html, new RegExp(`data-testid="em-diff-${d.id}"`));
  assert.match(tag(html, "em-diff-d-subject"), /data-accepted="true"/);
  assert.match(tag(html, "em-diff-d-body"), /data-accepted="false"/);
  assert.equal(html.match(/data-testid="em-accept-/g)?.length, 2, "only the two open diffs have Accept");
  assert.ok(html.includes("Accepted"));
  assert.ok(renderToStaticMarkup(<EmailBuilder {...base} askOpen diffs={[]} />).includes("Nothing suggested yet"));
});

test("the header has Test send, Focus, Undo and Redo, the saved version and the shared Ask control when given", () => {
  const html = renderToStaticMarkup(<EmailBuilder {...base} version={4}
    ask={{ place: "email", context: { kind: "email", id: "em1", title: "Q4 follow-up", access: "edit" }, agents: [{ id: "a", name: "Assistant", assistant: true }, { id: "w", name: "Writer" }], onAsk: () => undefined }} />);
  for (const id of ["em-test-send", "em-focus", "em-undo", "em-redo"]) assert.ok(html.includes(`data-testid="${id}"`), id);
  assert.match(html, /Saved v4/);
  assert.match(html, /Ask/);
  assert.match(tag(html, "em-undo"), /aria-disabled="true"|disabled/);
});

test("preview frames: desktop, mobile and dark are the three tabs; the pane tabs are Style, Ask, Preview, Checks", () => {
  assert.deepEqual([...EMAIL_PREVIEWS], ["desktop", "mobile", "dark"]);
  assert.deepEqual([...PANE_TABS], ["style", "ask", "preview", "checks"]);
  const html = renderToStaticMarkup(<EmailBuilder {...base} paneTab="preview" preview="mobile" mergeValues={{ first_name: "Elena" }} />);
  assert.match(tag(html, "email-builder"), /data-preview="mobile"/);
  for (const p of EMAIL_PREVIEWS) assert.ok(html.includes(`data-testid="em-pv-${p}"`), p);
  const checks = renderToStaticMarkup(<EmailBuilder {...base} paneTab="checks" />);
  for (const id of ["subject", "preview", "plain", "unsub"]) assert.ok(checks.includes(`data-testid="em-check-${id}"`), id);
});

test("merge tokens draw as chips and keep the token in data-token", () => {
  assert.deepEqual(splitTokens("Hi {{first_name|there}}, ok").map((r) => r.text), ["Hi ", "first name", ", ok"]);
  const html = renderToStaticMarkup(<EmailBuilder {...base} blocks={[{ id: "t", kind: "text", text: "Hi {{first_name|there}}" }]} />);
  assert.match(html, /data-token="\{\{first_name\|there\}\}"/);
});

test("Style pane shows the brand with Use brand; Preview pane shows the inbox row and Send test; Ask pane shows the conversation and composer", () => {
  const style = renderToStaticMarkup(<EmailBuilder {...base} brand={{ name: "Northwind", color: "#5B5BD6", font: "Inter" }} />);
  assert.ok(style.includes('data-testid="em-brand"') && style.includes('data-testid="em-use-brand"') && style.includes("#5B5BD6"));
  assert.ok(!renderToStaticMarkup(<EmailBuilder {...base} />).includes('data-testid="em-brand"'), "no brand, no section");
  const pv = renderToStaticMarkup(<EmailBuilder {...base} paneTab="preview" fromName="Maya Chen" testTo="Irfad" previewAs="Elena Rivera" />);
  assert.ok(pv.includes('data-testid="em-inbox"') && pv.includes('data-testid="em-preview-send"') && pv.includes("Maya Chen") && pv.includes("For Elena Rivera"));
  const ask = renderToStaticMarkup(<EmailBuilder {...base} paneTab="ask" askThread={[{ from: "you", text: "Warmer please" }, { from: "assistant", text: "Done" }]} />);
  assert.ok(ask.includes('data-testid="em-composer"') && ask.includes('data-testid="em-msg-0"') && ask.includes("Warmer please") && ask.includes("Done"));
});
