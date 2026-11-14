// What a reader of a shared chat is served of an agent's saved steps (F51): the asker sees them whole; everyone else sees the kind of step, how it went and how long, and turns saved long ago are served the same way.
import test from "node:test";
import assert from "node:assert/strict";
import { messageOut } from "../projections.ts";
import type { MessageRec } from "../projections.ts";

const reply = {
  id: "msg_1",
  thread: "thr_1",
  seq: 1,
  author: "agt_x",
  kind: "agent",
  body: "Done.",
  paidBy: "usr_alice",
  depth: 0,
  attachments: [],
  reactions: [],
  pinned: false,
  createdAt: 1,
  blocks: [
    { type: "tool_call", v: 1, id: "b1", data: { id: "x1", name: "files_read", label: "alice-private-notes.txt" } },
    { type: "tool_result", v: 1, id: "b2", data: { id: "x1", ok: true, name: "files_read", secs: 2 } },
    { type: "tool_call", v: 1, id: "b3", data: { id: "x2", name: "Bash", ran: "2 passing, 1 failing" } },
    { type: "tool_call", v: 1, id: "b4", data: { id: "x3", name: "Agent", detail: "Check Alice's bank statement" } },
    { type: "text_card", v: 1, id: "b5", data: { keep: "me" } },
  ],
} as unknown as MessageRec;

test("the asker is served the saved steps whole", () => {
  assert.deepEqual((messageOut(reply, 0, "usr_alice") as { blocks: unknown[] }).blocks, reply.blocks);
});

test("another reader is served the kind of step, never its file, counts, description or the tool's own name", () => {
  const text = JSON.stringify(messageOut(reply, 0, "usr_bob"));
  for (const gone of ["alice-private-notes", "2 passing", "bank statement", "files_read"])
    assert.equal(text.includes(gone), false, gone);
  const blocks = (messageOut(reply, 0, "usr_bob") as { blocks: Array<{ data: Record<string, unknown> }> }).blocks;
  assert.deepEqual(blocks[1]!.data, { id: "x1", ok: true, secs: 2, name: "Read", words: "Reading files" });
  assert.deepEqual(blocks[4]!.data, { keep: "me" }, "other blocks are untouched");
});

test("a reader who is not named as the one who paid is served the plain steps too", () => {
  const noPayer = { ...reply, paidBy: undefined } as unknown as MessageRec;
  assert.equal(JSON.stringify(messageOut(noPayer, 0, "usr_alice")).includes("alice-private-notes"), false);
});

test("a failed turn's status names the account that failed to the asker only; others read that it failed and why", () => {
  const failed = {
    ...reply,
    blocks: [{ type: "turn_status", v: 1, id: "s1", data: { state: "failed", code: "engine.signin_missing", account: "Alice_Claude", program: "claude" } }],
  } as unknown as MessageRec;
  assert.equal(JSON.stringify(messageOut(failed, 0, "usr_alice")).includes("Alice_Claude"), true, "the asker's button opens that account");
  const other = JSON.stringify(messageOut(failed, 0, "usr_bob"));
  assert.equal(other.includes("Alice_Claude"), false);
  assert.equal(other.includes("engine.signin_missing"), true, "the plain reason stays");
});

test("the agent's browser cards: the asker sees the site, the summary and the picture; others read that a browser was used", () => {
  const cards = {
    ...reply,
    blocks: [
      { type: "chrome_step", v: 1, id: "c1", data: { agentId: "agt_x", site: "mybank.example", thumb: "data:image/png;base64,AAAA", state: "using" } },
      { type: "chrome_held", v: 1, id: "c2", data: { heldId: "h1", site: "mybank.example", kind: "payment", summary: "Pay 4,000 to Dana", state: "waiting" } },
      { type: "screenshot", v: 1, id: "c3", data: { computerId: "agt_x", fileId: "fil_private_shot", caption: "Opened mybank.example/accounts", live: true } },
      { type: "browser_screenshot", v: 1, id: "c5", data: { agentId: "agt_x", fileId: "fil_space_browser_shot", caption: "Opened mybank.example", live: true } },
      { type: "screenshot", v: 1, id: "c4", data: { computerId: "agt_x", fileId: "fil_asked_for", caption: "A shot you asked for" } },
    ],
  } as unknown as MessageRec;
  assert.equal(JSON.stringify(messageOut(cards, 0, "usr_alice")).includes("mybank.example"), true, "the asker sees their own page");
  const other = JSON.stringify(messageOut(cards, 0, "usr_bob"));
  for (const gone of ["mybank", "Pay 4,000", "fil_private_shot", "fil_space_browser_shot", "AAAA"]) assert.equal(other.includes(gone), false, gone);
  assert.equal(other.includes("Using a browser"), true);
  assert.equal(other.includes("fil_asked_for"), true, "a picture someone posted on purpose is not a live card");
});
