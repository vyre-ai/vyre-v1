// No tool or capability name reaches a hooks screen (lane l-hooks): a run says "stopped sending an email", a hook on a tool says what it is limited to in plain words, an action hook says what it does, and a
// snake_case or dotted name in anything a hook says is swapped for plain words. Checked on the model's strings and on the rendered pane and helper page.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatRightPane } from "./ChatRightPane.tsx";
import { createRoot } from "test-renderer";
import { find, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { HookCard } from "./HooksTab.tsx";
import { ranWhat, titleOf, whatOf } from "./hooks-model.ts";
import type { Hook } from "./hooks-model.ts";
import { createSample } from "./sample.ts";
import { actionWords, capWords, plainLine, plainTools } from "../../../../../../lib/hooks.ts";

const SNAKE = /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/;
const TOOLS = ["mail_send", "files_tree", "files_write", "records_update", "telephony_send_sms", "mcp__vyre__files_tree", "Bash", "WebFetch", "stripe_charge", "terminal_run"];

test("a run says what was stopped in plain words, never the tool's name", () => {
  for (const tool of TOOLS) for (const outcome of ["blocked", "allowed_once", "ok", "note", "error"] as const) {
    const w = ranWhat({ outcome, tool } as never);
    assert.ok(!SNAKE.test(w) && !w.includes(tool) && !/__/.test(w), `${outcome} ${tool}: ${w}`);
  }
  assert.equal(ranWhat({ outcome: "blocked", tool: "mail_send" } as never), "stopped sending an email");
  assert.equal(ranWhat({ outcome: "blocked", tool: "Bash" } as never), "stopped running a command");
  assert.equal(actionWords("telephony_send_sms"), "sending a text");
  assert.equal(actionWords("stripe_charge"), "moving money");
});

test("a hook's own words are made plain: a name in a summary or a reason becomes what it does", () => {
  assert.equal(plainTools("before mail_send, ask first"), "before sending an email, ask first");
  assert.equal(plainTools("format-changed.sh and check_address.sh stay as they are"), "format-changed.sh and check_address.sh stay as they are");
  assert.ok(!SNAKE.test(plainTools("stopped files_tree and records_update")));
  const line = plainLine({ event: "tool.before", kind: "action", matcher: "mail\\.send|mail\\.send_as|resend\\.send_email|mailgun\\.send_email", cap: "chat.post" });
  assert.equal(line, "before sending an email, post in the chat");
  assert.equal(plainLine({ event: "tool.before", kind: "check", matcher: "files_tree", instruction: "Ask first" }), "before an action, check: Ask first");
  assert.equal(capWords("chat.post"), "post in the chat");
  assert.equal(capWords("records.update"), "an action");
});

test("an action hook's card says what it does, not the capability", () => {
  const h = { kind: "action", spec: { cap: "chat.post" } } as unknown as Hook;
  assert.equal(whatOf(h), "Post in the chat");
  assert.equal(titleOf({ line: "after a task, post a line", event: "turn.end" }), "After a task");
});

test("the rendered Hooks tab holds no snake_case name in its words", () => {
  const s = createSample("northwind", { hooks: true });
  const html = renderToStaticMarkup(<ChatRightPane data={s.data} open onToggle={() => undefined} tab="hooks" window={{ start: 0, end: 500 }} paneWidth={640} />);
  const text = html.replace(/<[^>]*>/g, " ").replaceAll("&#x27;", "'").replaceAll("&amp;", "&");
  assert.ok(/Last ran/.test(text), "the cards say when they last ran");
  const hit = SNAKE.exec(text);
  assert.equal(hit, null, `a name showed: ${hit?.[0]}`);
});

test("a script is described by what it is for, not its file name; an event reads as an action, never a tool", async () => {
  const { describedAs, EVENT_WORDS } = await import("./hooks-model.ts");
  assert.equal(describedAs({ line: "before a helper acts, keep to the Space rules" }), "Keep to the Space rules");
  assert.equal(whatOf({ kind: "command", spec: { command: "rules.sh" }, line: "before a helper acts, keep to the Space rules" } as never), "Keep to the Space rules");
  assert.equal(whatOf({ kind: "command", spec: { command: "rules.sh" }, line: "" } as never), "rules.sh", "no description, the file name is all there is");
  assert.equal(EVENT_WORDS["tool.before"], "Before any action");
  assert.equal(EVENT_WORDS["tool.after"], "After any action");
});

test("the Edit form shows the plain choice, never the capability or a tool name; the matcher and the capability stay internal", async () => {
  const off = installDom();
  try {
    const mk = (over: Partial<Hook>): Hook => ({ id: "hok_a", scope: "chat", event: "outward.before", kind: "action", matcher: "mail\\.send|mail\\.send_as|resend\\.send_email|mailgun\\.send_email", line: "before any email, post a line", paused: false, madeBy: "agt_x", madeByKind: "agent", threadId: "thr_1", helpers: true, timeoutSec: 20, createdAt: 1, updatedAt: 1, spec: { cap: "chat.post", input: {} }, mine: true, canChange: true, ...over } as Hook);
    for (const h of [mk({}), mk({ spec: { cap: "records.update", input: {} } }), mk({ kind: "check", spec: { instruction: "Ask first" } }), mk({ matcher: "files_tree" })]) {
      const root = await mount(createRoot, <HookCard h={h} threadId="thr_1" deps={{ call: async () => ({}), note: () => undefined }} selected={false} nameOf={() => "Intake"} ran="Never ran" />);
      await press(find(root, "hook-edit-hok_a"));
      const text = textOf(find(root, "hook-form-hok_a"));
      assert.ok(!SNAKE.test(text) && !/\b[a-z]+\.[a-z_]+\b/.test(text), `a name showed: ${text.slice(0, 200)}`);
      if (h.kind === "action") assert.ok(find(root, "hook-do-hok_a") && find(root, "hook-what-hok_a") === null, "an action is picked in words, not typed");
      assert.match(textOf(find(root, "hook-only-hok_a-value")), /^(Sending an email|Any action)$/, "Only for reads in plain words");
    }
  } finally { off(); }
});
