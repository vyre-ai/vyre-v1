// The line under the sender's message when they @mention someone not in the chat (owner, 12 Nov 2026).
import test from "node:test";
import assert from "node:assert/strict";
import { notInChatLine } from "./notinchat.ts";

const ME = "usr_dana";
const dir = [
  { id: ME, name: "Dana Reyes", kind: "person" as const }, { id: "usr_maya", name: "Maya Lin", kind: "person" as const }, { id: "usr_omar", name: "Omar Haddad", kind: "person" as const },
  { id: "usr_lee", name: "Lee Park", kind: "person" as const }, { id: "agt_dex", name: "Dex", kind: "agent" as const },
];
const msg = (body: string, o: Partial<{ id: string; author: string; kind: string }> = {}) => ({ messageId: o.id ?? "msg_1", author: { kind: "person", id: o.author ?? ME }, kind: o.kind ?? "text", body });
const base = { meId: ME, members: new Set([ME]), directory: dir, mayAdd: true };

test("one, two and three people: one line, one button", () => {
  assert.deepEqual(notInChatLine(msg("@Maya can you check this?"), base), { messageId: "msg_1", ids: ["usr_maya"], text: "Maya is not in this chat.", button: "Add" });
  assert.deepEqual(notInChatLine(msg("@Maya and @Omar please look"), base), { messageId: "msg_1", ids: ["usr_maya", "usr_omar"], text: "Maya and Omar are not in this chat.", button: "Add both" });
  assert.equal(notInChatLine(msg("@Maya @Omar @Lee"), base)?.button, "Add all 3");
  assert.equal(notInChatLine(msg("@Maya @Omar @Lee"), base)?.text, "Maya, Omar and Lee are not in this chat.");
});

test("may not add: the line says who can, with no button; cannot be added: says so, no button", () => {
  assert.deepEqual(notInChatLine(msg("@Maya can you check this?"), { ...base, mayAdd: false }), { messageId: "msg_1", ids: [], text: "Maya is not in this chat. Ask someone who manages it to add Maya.", button: null });
  assert.deepEqual(notInChatLine(msg("@Maya"), { ...base, addable: () => false }), { messageId: "msg_1", ids: [], text: "Maya is not in this chat and cannot be added.", button: null });
  assert.deepEqual(notInChatLine(msg("@Maya @Omar"), { ...base, addable: (id) => id !== "usr_omar" })?.ids, ["usr_maya"], "the button adds only who can be added");
});

test("only the sender sees it; nothing for a member, an agent, a pending message, a dismissed line; gone once the person is in the chat (decided from data, so a reload keeps it while true)", () => {
  assert.equal(notInChatLine(msg("@Maya", { author: "usr_omar" }), base), null, "someone else's message: not their line to see");
  assert.equal(notInChatLine(msg("@Dex take this"), base), null, "an agent has its own line");
  assert.equal(notInChatLine(msg("@Maya", { id: "pending:k1" }), base), null);
  assert.equal(notInChatLine(msg("@Maya"), { ...base, dismissed: new Set(["msg_1"]) }), null);
  assert.equal(notInChatLine(msg("@Maya"), { ...base, members: new Set([ME, "usr_maya"]) }), null, "after Add, or anyone else adding her, the line goes");
  const again = notInChatLine(msg("@Maya can you check this?"), base);
  assert.deepEqual(again, notInChatLine(msg("@Maya can you check this?"), base), "the same data gives the same line after a reload");
});
