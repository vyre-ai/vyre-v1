// The stop in a chat, drawn by the real conversation (lane l-hooks): the quiet line keeps its system verbs, and the agent's reply directly below carries the check's steps as buttons.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Conversation } from "./Conversation.tsx";
import { createSample } from "./sample.ts";
import type { Message } from "./model.ts";

const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&amp;", "&");

test("a stop draws as a quiet line with Details (the rest once it is known the person may decide), then the agent's reply with the steps as buttons inside it", () => {
  const s = createSample("idle");
  const rows = (s.replica.rows("messages") as unknown as (Message & { id: string })[]).filter((m) => m.threadId === s.data.threadId).sort((a, b) => a.threadSeq - b.threadSeq);
  const last = rows[rows.length - 1]!;
  const stop = { messageId: "msg_stop", threadId: s.data.threadId, threadSeq: last.threadSeq + 1, author: { kind: "agent", id: "agt_intake" }, kind: "quiet", body: "A hook stopped this: the address isn't in Contacts", depth: 0, attachments: [], reactions: [], pinned: false, createdAt: last.createdAt + 60_000,
    blocks: [{ type: "hook", v: 1, id: "blk_stop", state: "done", data: { threadId: s.data.threadId, kind: "blocked", line: "A hook stopped this: the address isn't in Contacts", hookId: "hok_1", agentId: "agt_intake", next: [{ label: "Add Harbor Supply to Contacts", ask: "Please add Harbor Supply to Contacts" }, { label: "Send once without adding", ask: "Send it once without adding them" }] } }] };
  const reply = { messageId: "msg_reply", threadId: s.data.threadId, threadSeq: last.threadSeq + 2, author: { kind: "agent", id: "agt_intake" }, kind: "agent", body: "I did not send it. Harbor Supply's address is not in Contacts yet.", depth: 0, attachments: [], reactions: [], pinned: false, createdAt: last.createdAt + 65_000, blocks: [] };
  s.replica.put("messages", [stop, reply].map((m) => ({ id: m.messageId, ...m })));
  const out = clean(renderToStaticMarkup(<Conversation data={{ ...s.data, nav: { ...s.data.nav, openHooks: () => undefined } }} />));
  const line = out.indexOf('data-testid="event-msg_stop"'), steps = out.indexOf('data-testid="hook-steps-msg_reply"'), replyAt = out.indexOf("I did not send it.");
  assert.ok(line >= 0 && replyAt > line && steps > replyAt, "the line, then the reply, then the steps inside the reply");
  assert.ok(out.includes('data-testid="hook-act-details-msg_stop"'), "Details shows at once; Allow, Always allow and Deny or Ask an admin follow when it is known whether the person may decide");
  assert.ok(!out.includes('data-testid="hook-next-0-msg_stop"'), "the line does not carry the steps");
  assert.ok(out.includes("Add Harbor Supply to Contacts") && out.includes("Send once without adding"));
});
