import test from "node:test";
import assert from "node:assert/strict";
import { Dimensions } from "react-native";
import { renderToStaticMarkup } from "react-dom/server";
import { FormAsk } from "../src/places/apps/shell/FormAsk.tsx";
import { applyChange, diffText, lineDiff, summaryOf } from "../src/places/apps/shell/form-ask.ts";
import type { SourceChange } from "../src/places/apps/shell/form-ask.ts";

Dimensions.set({ window: { width: 1280, height: 900, scale: 1, fontScale: 1 }, screen: { width: 1280, height: 900, scale: 1, fontScale: 1 } });
const agents = [{ id: "agt_a", name: "Builder" }, { id: "agt_b", name: "Writer" }];
const change: SourceChange = { path: "/html", before: '<vyre-field name="email"></vyre-field>', after: '<h1>Hi</h1>\n<vyre-field name="email"></vyre-field>' };
const render = (o: Partial<Parameters<typeof FormAsk>[0]> = {}) => renderToStaticMarkup(<FormAsk agents={agents} agentId="agt_a" onAgent={() => undefined} instruction="Add a heading" onInstruction={() => undefined} onAsk={() => undefined} dirty={false} proposals={[]} decided={{}} onAccept={() => undefined} onReject={() => undefined} {...o} />);

test("a line diff shows only what changed, with a little context, and the summary counts it", () => {
  assert.deepEqual(lineDiff("a\nb\nc\nd", "a\nB\nc\nd", 1), [{ kind: "same", text: "a" }, { kind: "del", text: "b" }, { kind: "add", text: "B" }, { kind: "same", text: "c" }]);
  assert.deepEqual(lineDiff("", "x\ny"), [{ kind: "add", text: "x" }, { kind: "add", text: "y" }]);
  assert.deepEqual(lineDiff("x", ""), [{ kind: "del", text: "x" }]);
  assert.deepEqual(lineDiff("same", "same"), []);
  assert.equal(summaryOf(change), "HTML: 1 line added, 0 removed");
  assert.equal(summaryOf({ path: "/js", before: "a\nb", after: "c" }), "JavaScript: 1 line added, 2 removed");
});

test("every proposed change is one block of marked lines under its field title", () => {
  assert.equal(diffText([change, { path: "/css", before: "a", after: "b" }]), 'HTML\n+ <h1>Hi</h1>\n  <vyre-field name="email"></vyre-field>\n\nCSS\n- a\n+ b');
});

test("accepting a change replaces only that field's text; an unknown field is not applied", () => {
  const state = { html: "h", css: "c", js: "j" };
  assert.deepEqual(applyChange(state, { path: "/css", before: "c", after: "C" }), { html: "h", css: "C", js: "j" });
  assert.deepEqual(applyChange(state, { path: "/js", before: "j", after: "" }), { html: "h", css: "c", js: "" });
  assert.equal(applyChange(state, { path: "/secret", before: "", after: "x" }), null);
});

test("the inline Ask offers an agent, says what to change, and never opens a chat", () => {
  const html = render();
  assert.ok(html.includes("apps-form-ask") && html.includes("apps-ask-send") && html.includes("Agent"));
  assert.ok(!html.includes("chat"), "no chat is opened from here");
  assert.ok(render({ agents: [agents[0]!] }).includes("Agent") === false, "one agent needs no picker");
  assert.ok(render({ agents: [] }).includes("apps-ask-no-agent"));
});

test("Ask is blocked while unsaved edits exist, while it runs, and with no instruction; a running Ask names its agent and offers Cancel", () => {
  const disabled = (html: string) => /data-testid="apps-ask-send"[^>]*aria-disabled="true"|aria-disabled="true"[^>]*data-testid="apps-ask-send"/.test(html);
  assert.equal(disabled(render()), false);
  assert.equal(disabled(render({ dirty: true })), true); assert.ok(render({ dirty: true }).includes("apps-ask-save-first"));
  assert.equal(disabled(render({ instruction: "  " })), true);
  const running = render({ asking: { agent: "Builder", onCancel: () => undefined } });
  assert.ok(running.includes("Asking Builder") && running.includes("apps-ask-cancel") && !running.includes("apps-ask-send"));
});

test("each proposed change is reviewed on its own: diff, Accept and Reject; a decided change says so; a failure is shown in words", () => {
  const open = render({ proposals: [change, { path: "/css", before: "", after: ".a{}" }] });
  for (const id of ["html", "css"]) assert.ok(open.includes(`apps-ask-accept-${id}`) && open.includes(`apps-ask-reject-${id}`));
  assert.ok(open.includes("apps-ask-diff") && open.includes("HTML") && open.includes("CSS"));
  assert.ok(open.includes("+ &lt;h1&gt;Hi&lt;/h1&gt;") || open.includes("+ <h1>Hi</h1>"));
  const decided = render({ proposals: [change, { path: "/css", before: "", after: ".a{}" }], decided: { "/html": "accepted", "/css": "rejected" } });
  assert.ok(decided.includes("apps-ask-accepted-html") && decided.includes("Save the form to keep it") && decided.includes("apps-ask-rejected-css"));
  assert.ok(!decided.includes("apps-ask-accept-html") && !decided.includes("apps-ask-reject-css"));
  assert.ok(render({ error: "The provider rejected the key or sign-in for this agent. Open Settings and reconnect it." }).includes("reconnect it"));
});
