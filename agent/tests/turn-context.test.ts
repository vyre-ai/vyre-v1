// The turn context (agent/src/turn-engine/context.ts): the order of the sections, how an API driver and a CLI engine are given it, speaker names instead of ids, and the screen context parser.
import test from "node:test";
import assert from "node:assert/strict";
import { defaultPrompt } from "../src/drivers/cli/prompt.ts";
import { threadMessages } from "../src/drivers/api/messages.ts";
import { SECTION_ORDER, contextBlocks, contextPrompt, ordered, parseScreen, screenText, speaker } from "../src/turn-engine/context.ts";
import type { ContextSection, TurnContext } from "../src/turn-engine/context.ts";
import type { StoredMessage, TurnInput } from "../src/turn-engine/types.ts";

const sec = (id: ContextSection["id"], stable: boolean, text: string): ContextSection => ({ id, stable, text });
const ctx = (): TurnContext => ({
  names: { usr_maya: "Maya Chen", usr_omar: "Omar Haddad", agt_intake: "Intake" },
  sections: [sec("now", false, "It is Thursday."), sec("identity", true, "You are Intake."), sec("where", true, "Space: Core."), sec("memory", true, "Memory rules."), sec("screen", false, "The person is in records."), sec("can", true, "Tools: all.")],
});
const msg = (id: string, who: string, kind: "person" | "agent", body: string, seq: number): StoredMessage => ({ id, threadId: "thr_1", threadSeq: seq, author: { kind, id: who }, mentions: [], depth: 0, body });
const input = (over: Partial<TurnInput> = {}): TurnInput => ({
  threadId: "thr_1", turnId: "trn_1", agent: { id: "agt_intake", mode: "lead" }, trigger: msg("m3", "usr_maya", "person", "what is next?", 3),
  history: [msg("m1", "usr_omar", "person", "the Smith matter is late", 1), msg("m2", "agt_intake", "agent", "I will look", 2), msg("m3", "usr_maya", "person", "what is next?", 3)],
  listeners: [], asker: "usr_maya", ...over,
});

test("sections come out in the fixed order whatever order they were built in, and empty ones are dropped", () => {
  const got = ordered([...ctx().sections, sec("skills", true, "   ")]);
  assert.deepEqual(got.map((s) => s.id), ["identity", "where", "memory", "can", "screen", "now"]);
  assert.deepEqual(got.map((s) => s.id), SECTION_ORDER.filter((id) => got.some((s) => s.id === id)));
});

test("an API driver gets one block per section, the stable ones marked for the cache", () => {
  const blocks = contextBlocks(ctx());
  assert.equal(blocks.length, 6);
  assert.deepEqual(blocks.map((b) => b.stable), [true, true, true, true, false, false]);
  assert.match(blocks[0]!.text, /^You are Intake\./);
  assert.match(blocks[1]!.text, /^Where you are:\nSpace: Core\./);
});

test("a fresh CLI session gets every section; a resumed one only what changed or is volatile", () => {
  const sent = new Map<string, string>();
  const first = contextPrompt(ctx(), true, sent);
  assert.match(first, /^<vyre-context>\nYou are Intake\./);
  assert.match(first, /It is Thursday\.\n<\/vyre-context>$/);
  const c = ctx();
  const again = contextPrompt(c, false, sent);
  assert.doesNotMatch(again, /You are Intake/, "a stable section is not sent twice");
  assert.match(again, /The person is in records\./);
  assert.match(again, /It is Thursday\./);
  const changed = { ...c, sections: c.sections.map((s) => (s.id === "can" ? { ...s, text: "Tools: all. Routines: one." } : s)) };
  const third = contextPrompt(changed, false, sent);
  assert.match(third, /Routines: one\./, "a changed stable section is sent again");
  assert.doesNotMatch(third, /Memory rules/);
});

test("the CLI prompt names speakers by their real names and carries the context in front", () => {
  const p = defaultPrompt(input({ context: ctx() }), true);
  assert.match(p, /^<vyre-context>/);
  assert.match(p, /Omar Haddad: the Smith matter is late/);
  assert.match(p, /Intake: I will look/);
  assert.doesNotMatch(p, /usr_omar/);
  assert.match(p, /what is next\?$/);
});

test("without a context the CLI prompt is what it was", () => {
  const p = defaultPrompt(input(), true);
  assert.doesNotMatch(p, /vyre-context/);
  assert.match(p, /usr_omar: the Smith matter is late/);
});

test("an API driver labels other voices by name when more than one person is in the thread", () => {
  const rows = threadMessages(input({ context: ctx() }));
  const first = rows[0]!;
  assert.equal(first.role, "user");
  assert.match((first as { text: string }).text, /Omar Haddad: the Smith matter is late/);
  assert.match((rows[2] as { text: string }).text, /Maya Chen: what is next\?/);
});

test("a speaker with no known name falls back to the id", () => {
  assert.equal(speaker(ctx(), "usr_nobody"), "usr_nobody");
  assert.equal(speaker(undefined, "usr_maya"), "usr_maya");
});

test("the screen context parser keeps the shape and drops what is not", () => {
  const s = parseScreen({
    place: "records", title: "Contacts", open: [{ type: "record", id: "rec_1", title: "Maya Chen" }, { type: 4 }], selection: [{ type: "record", id: "rec_2" }],
    filters: { stage: "New", tags: ["a", 1, "b"], bad: 3 }, rows: { shown: 25, total: 137, sample: ["Maya Chen, New", 5] }, actions: ["records.update", 9], focus: "focus-records",
  });
  assert.deepEqual(s?.open, [{ type: "record", id: "rec_1", title: "Maya Chen" }]);
  assert.deepEqual(s?.filters, { stage: "New", tags: ["a", "b"] });
  assert.deepEqual(s?.rows, { shown: 25, total: 137, sample: ["Maya Chen, New"] });
  assert.deepEqual(s?.actions, ["records.update"]);
  assert.equal(s?.focus, "focus-records");
  assert.equal(parseScreen({ title: "no place" }), undefined);
  assert.equal(parseScreen("records"), undefined);
  assert.equal(parseScreen({ place: "x", focus: "Not A Name!" })?.focus, undefined);
});

test("the screen section says where the person is, what is open and selected, filters and rows", () => {
  const t = screenText(parseScreen({ place: "records", title: "Contacts", open: [{ type: "record", id: "rec_1", title: "Maya Chen" }], filters: { stage: "New" }, rows: { shown: 25, total: 137 } }));
  assert.match(t, /^The person is in records, on "Contacts"\./);
  assert.match(t, /Open: record rec_1 "Maya Chen"\./);
  assert.match(t, /Filters: stage=New\./);
  assert.match(t, /Rows on screen: 25 of 137\./);
  assert.equal(screenText(undefined), "");
});
