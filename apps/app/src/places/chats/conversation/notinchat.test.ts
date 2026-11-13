// The line under the sender's message when they @mention someone not in the chat (owner, 12 Nov 2026).
import test from "node:test";
import assert from "node:assert/strict";
import { notInChatLine } from "./notinchat.ts";

const ME = "usr_dana";
const dir = [
  { id: ME, name: "Dana Reyes", kind: "person" as const },
  { id: "usr_maya", name: "Maya Lin", kind: "person" as const },
  { id: "usr_omar", name: "Omar Haddad", kind: "person" as const },
  { id: "usr_lee", name: "Lee Park", kind: "person" as const },
  { id: "agt_dex", name: "Dex", kind: "agent" as const },
];
// the composer's chips for "@First" in the body, as chat.post keeps them; `mentions` overrides
const chipsOf = (body: string) =>
  [...body.matchAll(/@(\w+)/g)].flatMap((x) =>
    dir
      .filter((c) => c.name.split(" ")[0] === x[1])
      .slice(0, 1)
      .map((c) => ({ kind: c.kind, id: c.id })),
  );
const msg = (
  body: string,
  o: Partial<{ id: string; author: string; kind: string; mentions: Array<{ kind: string; id: string }> }> = {},
) => ({
  messageId: o.id ?? "msg_1",
  author: { kind: "person", id: o.author ?? ME },
  kind: o.kind ?? "text",
  body,
  mentions: o.mentions ?? chipsOf(body),
});
const base = { meId: ME, members: new Set([ME]), directory: dir, mayAdd: true };

test("one, two and three people: one line, one button", () => {
  assert.deepEqual(notInChatLine(msg("@Maya can you check this?"), base), {
    messageId: "msg_1",
    ids: ["usr_maya"],
    who: [{ kind: "person", id: "usr_maya" }],
    text: "Maya is not in this chat.",
    button: "Add",
  });
  assert.deepEqual(notInChatLine(msg("@Maya and @Omar please look"), base), {
    messageId: "msg_1",
    ids: ["usr_maya", "usr_omar"],
    who: [
      { kind: "person", id: "usr_maya" },
      { kind: "person", id: "usr_omar" },
    ],
    text: "Maya and Omar are not in this chat.",
    button: "Add both",
  });
  assert.equal(notInChatLine(msg("@Maya @Omar @Lee"), base)?.button, "Add all 3");
  assert.equal(notInChatLine(msg("@Maya @Omar @Lee"), base)?.text, "Maya, Omar and Lee are not in this chat.");
});

test("may not add: the line says who can, with no button; cannot be added: says so, no button", () => {
  assert.deepEqual(notInChatLine(msg("@Maya can you check this?"), { ...base, mayAdd: false }), {
    messageId: "msg_1",
    ids: [],
    who: [],
    text: "Maya is not in this chat. Ask someone who manages it to add Maya.",
    button: null,
  });
  assert.deepEqual(notInChatLine(msg("@Maya"), { ...base, addable: () => false }), {
    messageId: "msg_1",
    ids: [],
    who: [],
    text: "Maya is not in this chat and cannot be added.",
    button: null,
  });
  assert.deepEqual(
    notInChatLine(msg("@Maya @Omar"), { ...base, addable: (id) => id !== "usr_omar" })?.ids,
    ["usr_maya"],
    "the button adds only who can be added",
  );
});

test("only the sender sees it; nothing for a member, an agent, a pending message, a dismissed line; gone once the person is in the chat (decided from data, so a reload keeps it while true)", () => {
  assert.equal(
    notInChatLine(msg("@Maya", { author: "usr_omar" }), base),
    null,
    "someone else's message: not their line to see",
  );
  assert.equal(
    notInChatLine(msg("@Dex take this"), base),
    null,
    "without the chat's agents known, an agent is not judged",
  );
  assert.equal(notInChatLine(msg("@Maya", { id: "pending:k1" }), base), null);
  assert.equal(notInChatLine(msg("@Maya"), { ...base, dismissed: new Set(["msg_1"]) }), null);
  assert.equal(
    notInChatLine(msg("@Maya"), { ...base, members: new Set([ME, "usr_maya"]) }),
    null,
    "after Add, or anyone else adding her, the line goes",
  );
  const again = notInChatLine(msg("@Maya can you check this?"), base);
  assert.deepEqual(
    again,
    notInChatLine(msg("@Maya can you check this?"), base),
    "the same data gives the same line after a reload",
  );
});

test("an agent named who is not in the chat gets the same line and button, after the people (lead, 12 Nov)", () => {
  const withAgents = { ...base, agents: new Set<string>() };
  assert.deepEqual(notInChatLine(msg("@Dex take this"), withAgents), {
    messageId: "msg_1",
    ids: ["agt_dex"],
    who: [{ kind: "agent", id: "agt_dex" }],
    text: "Dex is not in this chat.",
    button: "Add",
  });
  assert.equal(
    notInChatLine(msg("@Dex and @Maya"), withAgents)?.text,
    "Maya and Dex are not in this chat.",
    "people first",
  );
  assert.equal(
    notInChatLine(msg("@Dex take this"), { ...base, agents: new Set(["agt_dex"]) }),
    null,
    "an agent already here: no line",
  );
});

test("the line comes from the message's chips, never names in its words (review M4)", () => {
  assert.equal(
    notInChatLine(msg("@Maya can you check this?", { mentions: [] }), base),
    null,
    "a name typed as plain text is no mention",
  );
  const two = [...dir, { id: "usr_maya2", name: "Maya Ortiz", kind: "person" as const }];
  assert.deepEqual(
    notInChatLine(msg("@Maya can you check this?", { mentions: [{ kind: "person", id: "usr_maya2" }] }), {
      ...base,
      directory: two,
    })?.ids,
    ["usr_maya2"],
    "the Maya who was picked, not the first Maya",
  );
  assert.equal(
    notInChatLine(msg("@Maya", { mentions: [{ kind: "person", id: "usr_gone" }] }), base),
    null,
    "someone no longer in the Space: nothing, as the people picker shows nothing",
  );
});
