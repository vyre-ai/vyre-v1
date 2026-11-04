// No tool or capability name reaches a hooks screen (lane l-hooks): a run says "stopped sending an email", a hook on a tool says what it is limited to in plain words, an action hook says what it does, and a
// snake_case or dotted name in anything a hook says is swapped for plain words. Checked on the model's strings and on the rendered pane and helper page.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatRightPane } from "./ChatRightPane.tsx";
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
