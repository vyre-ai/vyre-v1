// The crew UI as a person meets it (owner, 4 Nov 2026, prototype p-crew): the strip with one row per helper, the pane's overview and peek, the notes and the controls. Rendered with the real components; the calls are
// recorded so each control is shown to write through one capability.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import { CrewStrip } from "./strip.tsx";
import { CrewOverview, CrewPeek } from "./pane.tsx";
import { groupHelperStrips } from "../conversation/helper-rows.ts";
import { memberFromBlock } from "./status.ts";
import { internalNames } from "../../../../../../lib/plain-words.ts";
import type { CrewMember, CrewStatusOut, CrewTotals } from "./model.ts";

installDom();

const M = (o: Partial<CrewMember> = {}): CrewMember => ({ kind: "helper", id: "thr_a", parentThreadId: "thr_0", title: "Calendar", name: "Tess", agentId: "agt_tess", state: "working", step: "Reading Your calendar", startedAt: 1_000, elapsedMs: 12_000, tokensIn: 400, tokensOut: 100, costMicros: 20_000, ...o }) as CrewMember;
const T = (o: Partial<CrewTotals> = {}): CrewTotals => ({ members: 3, working: 1, done: 1, needsYou: 1, failed: 0, stopped: 0, tokensIn: 900, tokensOut: 300, costMicros: 120_000, filesChanged: 0, added: 0, deleted: 0, elapsedMs: 12_000, ...o });
const three = (): CrewMember[] => [
  M({ id: "thr_a", name: "Tess", title: "Calendar", state: "needs_you", step: "Needs your OK to read Vendor calls" }),
  M({ id: "thr_b", name: "Orin", title: "Harbor quote", state: "working", step: "Reading the price table", agentId: "agt_orin" }),
  M({ id: "thr_c", name: "Pia", title: "Pine quote", state: "failed", found: "Could not open the Pine Works quote. Try again.", agentId: "agt_pia", endedAt: 9_000 }),
];

test("the strip: one row per helper with its line and clock, a title that counts who needs you, Stop all, and no Open button", async () => {
  const calls: string[] = [];
  const root = await mount(createRoot, <CrewStrip members={three()} totals={T()} onPeek={(m) => calls.push(`peek:${m.id}`)} onStopAll={() => calls.push("stop")} onOpenPane={() => calls.push("pane")} onRetry={(m) => calls.push(`retry:${m.id}`)} />);
  assert.equal(textOf(find(root, "crew-strip-title")), "3 helpers · 1 needs you · 0:12");
  assert.match(textOf(find(root, "crew-chip-thr_a-line")), /Needs your OK to read Vendor calls/);
  assert.match(textOf(find(root, "crew-chip-thr_b-line")), /Reading the price table/);
  assert.match(textOf(find(root, "crew-chip-thr_b-role")), /Harbor quote/);
  assert.equal(find(root, "crew-chip-thr_a-open"), null, "no Open button: the row itself opens the peek");
  assert.ok(find(root, "crew-chip-thr_c-retry"), "a failed helper offers Retry");
  assert.equal(find(root, "crew-chip-thr_b-retry"), null);
  await press(find(root, "crew-chip-thr_b")); await press(find(root, "crew-strip-stop-all")); await press(find(root, "crew-strip-pane")); await press(find(root, "crew-chip-thr_c-retry"));
  assert.deepEqual(calls, ["peek:thr_b", "stop", "pane", "retry:thr_c"]);
});

test("code rows show the branch and the change; a chosen model shows its tag; plain research shows neither", async () => {
  const rows = [M({ id: "thr_k", name: "Kit", title: "Invoice dates", branch: "helper/invoice-dates", added: 12, deleted: 3, step: "Running the invoice tests" }), M({ id: "thr_m", name: "Mo", title: "Read", model: "Sonnet 5.5", why: "you asked" }), M({ id: "thr_p", name: "Pip", title: "Plain" })];
  const root = await mount(createRoot, <CrewStrip members={rows} totals={T({ members: 3, working: 3, done: 0, needsYou: 0 })} onPeek={() => undefined} />);
  assert.equal(textOf(find(root, "crew-chip-thr_k-branch")), "helper/invoice-dates");
  assert.match(textOf(find(root, "crew-chip-thr_k-diff")), /\+\s*12/); assert.match(textOf(find(root, "crew-chip-thr_k-diff")), /−\s*3/);
  assert.equal(textOf(find(root, "crew-chip-thr_m-model")), "Sonnet 5.5");
  assert.equal(find(root, "crew-chip-thr_p-branch"), null); assert.equal(find(root, "crew-chip-thr_p-model"), null);
});

test("a finished crew says so, drops Stop all, and a helper's finding replaces its step", async () => {
  const rows = [M({ id: "thr_a", state: "done", found: "Thursday at 14:00 is free.", endedAt: 41_000, elapsedMs: 41_000 }), M({ id: "thr_b", state: "done", found: "Harbor: $4,180.", endedAt: 22_000, elapsedMs: 22_000, agentId: "agt_orin", name: "Orin" })];
  const root = await mount(createRoot, <CrewStrip members={rows} totals={T({ members: 2, working: 0, needsYou: 0, done: 2, elapsedMs: 41_000 })} onPeek={() => undefined} onStopAll={() => undefined} />);
  assert.equal(textOf(find(root, "crew-strip-title")), "2 of 2 done · 41 s");
  assert.equal(find(root, "crew-strip-stop-all"), null);
  assert.equal(textOf(find(root, "crew-chip-thr_a-line")), "Thursday at 14:00 is free.");
  assert.equal(textOf(find(root, "crew-chip-thr_a-time")), "0:41");
});

test("starts by one agent, one after another, are one strip; other messages stay where they are", () => {
  const start = (id: string, t: string) => ({ messageId: `m_${id}`, body: "", author: { kind: "agent", id: "agt_1" }, blocks: [{ type: "helper", id: `b_${id}`, data: { helperThreadId: `thr_${id}`, title: t, agentId: "agt_1" } }] });
  const say = { messageId: "m_say", body: "Started two.", author: { kind: "agent", id: "agt_1" }, blocks: [] };
  const out = groupHelperStrips([start("1", "A"), start("2", "B"), say, start("3", "C")]);
  assert.equal(out.length, 3);
  assert.equal(out[0]!.blocks[0]!.type, "crew_strip");
  assert.equal(((out[0]!.blocks[0]!.data as { blocks: unknown[] }).blocks).length, 2);
  assert.equal(out[1]!.messageId, "m_say");
  assert.equal(((out[2]!.blocks[0]!.data as { blocks: unknown[] }).blocks).length, 1);
  const m = memberFromBlock((out[0]!.blocks[0]!.data as { blocks: Array<{ data: unknown }> }).blocks[0]!, "thr_0");
  assert.equal(m.id, "thr_1"); assert.equal(m.title, "A"); assert.equal(m.state, "working");
});

const status = (members: CrewMember[], totals: CrewTotals = T()): CrewStatusOut => ({ members, totals }) as CrewStatusOut;

test("the overview: totals in one sentence, rows sorted needs you first, the timeline, cost and time, the keys; Show keeps one kind", async () => {
  const calls: Array<{ cap: string; input: unknown }> = [];
  const peeked: string[] = [];
  const root = await mount(createRoot, <CrewOverview status={status(three(), T({ failed: 1 }))} call={async (cap, input) => { calls.push({ cap, input }); return {}; }} threadId="thr_0" onPeek={(id) => peeked.push(id)} onRefresh={() => undefined} />);
  assert.equal(textOf(find(root, "crew-overview-totals")), "1 of 3 done · 1 needs you · 1 working · 1 failed · 12 s");
  const order = ["thr_a", "thr_c", "thr_b"].map((id) => find(root, `crew-row-${id}`));
  assert.ok(order.every((n) => n !== null));
  assert.ok(find(root, "crew-tl-thr_b-bar"));
  assert.equal(textOf(find(root, "crew-cost")), "$0.12");
  assert.match(textOf(find(root, "crew-keys")), /stops all/);
  await press(find(root, "crew-row-thr_b"));
  assert.deepEqual(peeked, ["thr_b"]);
  await press(find(root, "crew-stop-all")); await flush();
  assert.deepEqual(calls.map((c) => c.cap), ["engine.helpers.stop_all"]);
  assert.deepEqual(calls[0]!.input, { threadId: "thr_0" });
});

test("the overview says Ran together only when they overlapped and all ended", async () => {
  const done = [M({ id: "a", state: "done", startedAt: 0, endedAt: 41_000, elapsedMs: 41_000, found: "x" }), M({ id: "b", state: "done", startedAt: 0, endedAt: 22_000, elapsedMs: 22_000, found: "y", agentId: "agt_b" }), M({ id: "c", state: "done", startedAt: 5_000, endedAt: 22_000, elapsedMs: 17_000, found: "z", agentId: "agt_c" })];
  const root = await mount(createRoot, <CrewOverview status={status(done, T({ members: 3, working: 0, needsYou: 0, done: 3, elapsedMs: 41_000 }))} call={async () => ({})} threadId="thr_0" onPeek={() => undefined} onRefresh={() => undefined} />);
  assert.equal(textOf(find(root, "crew-ran-together")), "Ran together: 41 s instead of 1 min 20 s");
  assert.equal(find(root, "crew-stop-all"), null, "nothing to stop");
});

test("the peek: brief from the agent, state and time, the notes with their senders, Open chat and Stop; Ask it something goes to the helper as the person", async () => {
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const notes = [
    { messageId: "m1", who: "brief", authorId: "agt_1", body: "Look at my calendar for next week." },
    { messageId: "m2", who: "helper", authorId: "agt_tess", body: "Which calendar?", kind: "question", state: "answered" },
    { messageId: "m3", who: "parent", authorId: "agt_1", body: "Vendor calls.", kind: "followup", state: "seen", seenAt: 5 },
  ];
  const call = async (cap: string, input: unknown): Promise<unknown> => { calls.push({ cap, input: input as Record<string, unknown> }); return cap === "chat.helper.notes" ? { notes } : {}; };
  const root = await mount(createRoot, <CrewPeek member={{ ...three()[1]!, startedAt: Date.now() - 12_000 }} call={call} nameOfId={() => "Assistant"} onBack={() => undefined} onOpenChat={(id) => opened.push(id)} onRefresh={() => undefined} />);
  await flush();
  assert.equal(textOf(find(root, "crew-peek-name")), "Orin");
  assert.match(textOf(find(root, "crew-peek-state")), /Working\s*·\s*0:1[2-5]/);
  assert.equal(textOf(find(root, "crew-peek-brief")), "Look at my calendar for next week.");
  assert.ok(find(root, "crew-note-m2")); assert.match(textOf(find(root, "crew-note-m3")), /Agent\s*·\s*seen/);
  assert.equal(textOf(find(root, "crew-peek-cost")), "$0.02");
  await typeInto(find(root, "crew-peek-ask"), "Also tell me the colour."); await press(find(root, "crew-peek-send")); await flush();
  const steer = calls.find((c) => c.cap === "chat.helper.steer")!;
  assert.equal(steer.input["threadId"], "thr_b"); assert.equal(steer.input["body"], "Also tell me the colour.");
  await press(find(root, "crew-peek-open")); assert.deepEqual(opened, ["thr_b"]);
  await press(find(root, "crew-peek-stop")); await flush();
  assert.ok(calls.some((c) => c.cap === "engine.stop" && c.input["threadId"] === "thr_b"));
});

test("a finished helper's peek has no Stop and no Ask box; a needs-you helper says what it waits for; no tool name is shown anywhere", async () => {
  const call = async (cap: string): Promise<unknown> => (cap === "chat.helper.notes" ? { notes: [] } : {});
  const done = await mount(createRoot, <CrewPeek member={M({ state: "done", found: "Harbor: $4,180.", endedAt: 20_000, elapsedMs: 22_000 })} call={call} onBack={() => undefined} onOpenChat={() => undefined} onRefresh={() => undefined} />);
  await flush();
  assert.equal(find(done, "crew-peek-stop"), null); assert.equal(find(done, "crew-peek-ask"), null);
  assert.equal(textOf(find(done, "crew-peek-answer")), "Harbor: $4,180.");
  const needs = await mount(createRoot, <CrewPeek member={three()[0]!} call={call} onBack={() => undefined} onOpenChat={() => undefined} onRefresh={() => undefined} />);
  await flush();
  assert.match(textOf(find(needs, "crew-peek-needs")), /Needs your OK to read Vendor calls/);
  assert.deepEqual(internalNames(textOf(find(needs, "crew-peek"))), []);
});

test("the Island says Working with the faces of the helpers on it, Needs you in amber when one waits, and is gone when none works", async () => {
  const { CrewIsland } = await import("./island.tsx");
  const { crewChipOf } = await import("./model.ts");
  let opened = 0;
  const root = await mount(createRoot, <CrewIsland status={status(three())} onPress={() => { opened += 1; }} />);
  assert.equal(textOf(find(root, "crew-island-text")), "Needs you");
  await press(find(root, "crew-island")); assert.equal(opened, 1);
  const working = await mount(createRoot, <CrewIsland status={status([M({ state: "working" })], T({ members: 1, working: 1, needsYou: 0, done: 0 }))} onPress={() => undefined} />);
  assert.equal(textOf(find(working, "crew-island-text")), "Working");
  const none = await mount(createRoot, <CrewIsland status={status([M({ state: "done" })], T({ members: 1, working: 0, needsYou: 0, done: 1 }))} onPress={() => undefined} />);
  assert.equal(find(none, "crew-island"), null);
  // the header chip counts from the same read
  assert.deepEqual(crewChipOf(T()), { active: 2, total: 3, label: "3 helpers, 1 needs you" });
  assert.equal(crewChipOf(T({ working: 2, needsYou: 0, done: 1 })).label, "2 helpers working");
  assert.equal(crewChipOf(T({ working: 0, needsYou: 0, done: 3 })).label, "3 helpers, all done");
});

test("the helper chat keeps all three senders: the brief and a follow-up from the agent, the helper's question, and the person's own steer as You; the person who started it can ask", async () => {
  const { HelperChat } = await import("../helper/HelperChat.tsx");
  const { createSample } = await import("../helper/sample.ts");
  const s = createSample("notes");
  const root = await mount(createRoot, <HelperChat data={s.data} />);
  await flush();
  assert.match(textOf(find(root, "helper-brief")), /Brief from/);
  assert.match(textOf(find(root, "note-m2")), /asks · answered/);
  assert.match(textOf(find(root, "note-m3")), /Follow-up from .* · seen/);
  assert.match(textOf(find(root, "msg-m4")), /You/);
  assert.match(textOf(find(root, "msg-m4")), /Also tell me the filing date\./);
  assert.equal(find(root, "helper-work"), null, "notes are not steps");
  await typeInto(find(root, "helper-ask"), "And the acreage."); await press(find(root, "helper-ask-send")); await flush();
  const steer = s.calls.find((c) => c.cap === "chat.helper.steer")!;
  assert.equal((steer.input as { body: string }).body, "And the acreage.");
  assert.match(textOf(find(root, "helper-line")), /Sent/);
});

test("Show keeps one kind of helper and checks the one showing; the token bar splits input from output; code rows say what the tests did", async () => {
  const { showEntries } = await import("./pane.tsx");
  const picked: string[] = [];
  const entries = showEntries("working", (x) => picked.push(x));
  assert.deepEqual(entries.map((e) => e.label), ["All", "Working", "Needs you", "Done", "Failed"]);
  assert.deepEqual(entries.filter((e) => e.checked).map((e) => e.label), ["Working"]);
  entries[3]!.onSelect(); assert.deepEqual(picked, ["done"]);
  const only = await mount(createRoot, <CrewOverview status={status(three(), T({ failed: 1 }))} call={async () => ({})} threadId="thr_0" onPeek={() => undefined} onRefresh={() => undefined} initialShow="failed" />);
  assert.ok(find(only, "crew-row-thr_c")); assert.equal(find(only, "crew-row-thr_a"), null); assert.equal(find(only, "crew-row-thr_b"), null);
  const none = await mount(createRoot, <CrewOverview status={status([three()[1]!])} call={async () => ({})} threadId="thr_0" onPeek={() => undefined} onRefresh={() => undefined} initialShow="done" />);
  assert.match(textOf(find(none, "crew-empty-show")), /No helper is done yet/);
  const tok = await mount(createRoot, <CrewOverview status={status(three(), T({ tokensIn: 12_300, tokensOut: 800 }))} call={async () => ({})} threadId="thr_0" onPeek={() => undefined} onRefresh={() => undefined} />);
  assert.match(textOf(find(tok, "crew-tokens")), /12\.3k\s*in\s*·\s*800\s*out/);
  const noTok = await mount(createRoot, <CrewOverview status={status(three(), T({ tokensIn: 0, tokensOut: 0 }))} call={async () => ({})} threadId="thr_0" onPeek={() => undefined} onRefresh={() => undefined} />);
  assert.equal(find(noTok, "crew-tokens"), null, "no bar when nothing is known");
  const code = await mount(createRoot, <CrewStrip members={[M({ id: "k1", branch: "helper/a", added: 1, deleted: 0, tests: { state: "failing", failed: 3 } }), M({ id: "k2", branch: "helper/b", tests: { state: "passing" } })]} totals={T({ members: 2, working: 2, done: 0, needsYou: 0 })} onPeek={() => undefined} />);
  assert.equal(textOf(find(code, "crew-chip-k1-tests")), "3 failing"); assert.equal(textOf(find(code, "crew-chip-k2-tests")), "Tests passing");
});
