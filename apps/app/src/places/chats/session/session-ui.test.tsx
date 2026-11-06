// The long-session pieces as a person meets them (owner, 6 Nov 2026, prototype t-session): the compact crew block with rows that open to the last three steps, the away row that opens in place, the jump row, the
// Overview in the right pane and the context that carries a jump from the pane to the chat. Rendered with the real components.
import test from "node:test";
import { act } from "react";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { CrewBlock, statusWord, whoOf } from "./CrewBlock.tsx";
import { AwayRow, HourMark, JumpRow } from "./rows.tsx";
import { OverviewView, filesOf, waitingOf } from "./Overview.tsx";
import { SessionProvider, useSession } from "./context.tsx";
import { NO_SESSION } from "./model.ts";
import type { SessionSummary } from "./model.ts";
import type { CrewMember, CrewTotals } from "../crew/model.ts";

installDom();

const M = (o: Partial<CrewMember> = {}): CrewMember => ({ kind: "teammate", id: "thr_a", parentThreadId: "thr_0", title: "Server fixes", name: "Tess", agentId: "agt_tess", state: "working", step: "Running the install tests", startedAt: 1_000, elapsedMs: 420_000, tokensIn: 0, tokensOut: 0, costMicros: 0, ...o }) as CrewMember;
const T = (o: Partial<CrewTotals> = {}): CrewTotals => ({ members: 4, working: 1, done: 2, needsYou: 1, failed: 0, stopped: 0, tokensIn: 0, tokensOut: 0, costMicros: 0, filesChanged: 0, added: 0, deleted: 0, elapsedMs: 1_080_000, ...o });
const crew = (): CrewMember[] => [
  M({ id: "thr_t", name: "Tess", title: "Server fixes", state: "done", found: "74 tests pass on the lane box", elapsedMs: 1_080_000, endedAt: 1_081_000, files: [{ path: "images/vyred/compose.server.yml", added: 5, deleted: 0 }] }),
  M({ id: "thr_o", name: "Orin", title: "Chrome extension", state: "working", step: "Writing the version check" }),
  M({ id: "thr_k", name: "Kai", title: "Composer polish", state: "needs_you", step: "Asked you: 12 px or 14 px corners", files: [{ path: "ui/src/Composer/index.tsx", added: 3, deleted: 1 }] }),
];

test("a helper reads as a name, what it was asked, one word of status and a clock; a name that equals its task says it once", () => {
  assert.deepEqual(whoOf({ name: "Tess", title: "Server fixes" }), { name: "Tess", task: "Server fixes" });
  assert.deepEqual(whoOf({ title: "Calendar" }), { name: "Calendar", task: "" });
  assert.deepEqual(["working", "needs_you", "done", "failed", "stopped"].map((s) => statusWord(s as never)), ["Working", "Waiting on you", "Done", "Failed", "Stopped"]);
});

test("the crew block: a header that counts, one row per helper, the name opens the pane, a row opens to its last three steps", async () => {
  const peeked: string[] = [];
  const asked: string[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    asked.push(`${cap}:${(input as { threadId: string }).threadId}`);
    const tool = (n: number) => ({ id: `b${n}`, type: "step", v: 1, state: "done", data: { title: `Step ${n}` } });
    return { messages: [{ blocks: [1, 2, 3, 4, 5].map(tool) }] };
  };
  const root = await mount(createRoot, <CrewBlock members={crew()} totals={T()} call={call} onPeek={(m) => peeked.push(m.id)} onStopAll={() => undefined} onOpenPane={() => undefined} />);
  assert.match(textOf(find(root, "crew-strip-title")), /helpers|done/);
  assert.equal(textOf(find(root, "crew-chip-thr_o-state")), "Working");
  assert.equal(textOf(find(root, "crew-chip-thr_k-state")), "Waiting on you");
  assert.equal(textOf(find(root, "crew-chip-thr_t-state")), "Done");
  assert.equal(textOf(find(root, "crew-chip-thr_t-role")), "Server fixes");
  assert.equal(find(root, "crew-chip-thr_o-steps"), null, "rows start closed");
  assert.equal(asked.length, 0, "a closed row reads nothing");
  await press(find(root, "crew-chip-thr_o-name"));
  assert.deepEqual(peeked, ["thr_o"]);
  await press(find(root, "row-crew-chip-thr_o-toggle"));
  await flush();
  assert.ok(find(root, "crew-chip-thr_o-steps"));
  assert.ok(asked.includes("chat.messages.list:thr_o"));
  const open = textOf(find(root, "crew-chip-thr_o-steps"));
  assert.ok(open.includes("Step 5") && open.includes("Step 4") && open.includes("Step 3"), "the last three");
  assert.ok(!open.includes("Step 2"), "and no more");
  await press(find(root, "row-crew-chip-thr_o-toggle"));
  assert.equal(find(root, "crew-chip-thr_o-steps"), null);
});

test("an open row with no steps yet says what it is on", async () => {
  const root = await mount(createRoot, <CrewBlock members={crew()} totals={T()} call={async () => ({ messages: [] })} onPeek={() => undefined} />);
  await press(find(root, "row-crew-chip-thr_k-toggle"));
  await flush();
  assert.equal(textOf(find(root, "crew-chip-thr_k-line")), "Asked you: 12 px or 14 px corners");
});

test("the merge buttons, Stop all and the pane button sit in the header only when they can act", async () => {
  const calls: string[] = [];
  const root = await mount(createRoot, <CrewBlock members={crew()} totals={T()} merge={{ state: "ready", onReview: () => calls.push("review"), onMerge: () => calls.push("merge") }} onPeek={() => undefined} onStopAll={() => calls.push("stop")} onOpenPane={() => calls.push("pane")} />);
  await press(find(root, "crew-strip-review")); await press(find(root, "crew-strip-merge")); await press(find(root, "crew-strip-stop-all")); await press(find(root, "crew-strip-pane"));
  assert.deepEqual(calls, ["review", "merge", "stop", "pane"]);
  const done = await mount(createRoot, <CrewBlock members={[crew()[0]!]} totals={T({ members: 1, working: 0, needsYou: 0, done: 1 })} onPeek={() => undefined} onStopAll={() => undefined} />);
  assert.equal(find(done, "crew-strip-stop-all"), null, "nothing to stop");
});

test("the hour mark, the jump row and the away row", async () => {
  const hour = await mount(createRoot, <HourMark id="h1" label="9 PM" />);
  assert.equal(textOf(find(hour, "hour-h1")).trim(), "9 PM");
  const jump = await mount(createRoot, <JumpRow row={{ kind: "jump", key: "j", messageId: "m9", label: "Release tagged", sub: "v1.0.0-rc.22.1", time: "11:48 PM" }} />);
  assert.match(textOf(find(jump, "jump-m9")), /Release tagged/);
  assert.match(textOf(find(jump, "jump-m9")), /v1\.0\.0-rc\.22\.1 · 11:48 PM/);
  const lines = Array.from({ length: 12 }, (_, i) => ({ id: `l${i}`, who: i % 3 === 0 ? "" : "Tess", text: `thing ${i}`, time: "9:40 PM" }));
  const row = { kind: "away" as const, key: "away-m1", items: [], lines, things: 41, who: "Assistant", helpers: 3, needs: 2, span: "9:40 to 11:46 PM" };
  const away = await mount(createRoot, <AwayRow row={row} />);
  assert.match(textOf(find(away, "away-away-m1")), /While you were away/);
  assert.match(textOf(find(away, "away-away-m1")), /Assistant and 3 helpers did 41 things, 2 need you/);
  assert.match(textOf(find(away, "away-away-m1")), /9:40 to 11:46 PM/);
  assert.equal(find(away, "away-away-m1-items"), null);
  await press(find(away, "away-away-m1-toggle"));
  const open = textOf(find(away, "away-away-m1-items"));
  assert.ok(open.includes("thing 0") && open.includes("thing 7") && !open.includes("thing 8"), "opens in place to one line each, the first eight");
  assert.match(open, /Tess\s+thing 1/);
  assert.match(textOf(find(away, "away-away-m1-more")), /4 more, all quiet/);
  await press(find(away, "away-away-m1-more"));
  assert.ok(textOf(find(away, "away-away-m1-items")).includes("thing 11"));
  assert.equal(find(away, "away-away-m1-more"), null);
});

const summary = (o: Partial<SessionSummary> = {}): SessionSummary => ({ ...NO_SESSION, long: true, firstAsk: "Ship rc.22.1 tonight.", from: 0, to: (4 * 60 + 41) * 60_000, ...o });

test("the Overview lists the goal, helpers, files, decisions, open questions, jumps and usage; a helper opens its pane and a jump scrolls the chat", async () => {
  const log: string[] = [];
  const s = summary({
    decisions: [{ messageId: "m_d", kind: "decision", label: "Decision", sub: "Release after one green CI run", at: 1000, by: "usr_me" }],
    questions: [{ messageId: "m_q", text: "Which corner radius?", by: "agt_kai" }],
    jumps: [{ messageId: "m_r", kind: "release", label: "Release tagged", sub: "v1.0.0-rc.22.1", at: 2000, by: "agt_a" }],
  });
  const root = await mount(createRoot, <OverviewView goal="Ship rc.22.1" summary={s} members={crew()} context={{ words: "38% of 1M", frac: 0.38 }} clock={() => "11:48 PM"} who={(id) => (id === "usr_me" ? "You" : id === "agt_kai" ? "Kai" : id)} onHelper={(id) => log.push(`helper:${id}`)} onJump={(id) => log.push(`jump:${id}`)} />);
  const text = textOf(find(root, "session-overview"));
  for (const want of ["Goal", "Helpers", "Files touched", "Decisions", "Open questions", "Jump to", "Usage"]) assert.ok(text.includes(want), want);
  assert.equal(textOf(find(root, "overview-goal")), "Ship rc.22.1");
  assert.ok(text.includes("compose.server.yml") && text.includes("index.tsx"));
  assert.equal(textOf(find(root, "overview-context")).replace(/\s+/g, " ").trim(), "Context 38% of 1M");
  assert.match(textOf(find(root, "overview-ran")), /4 h 41 min/);
  assert.ok(find(root, "row-overview-waiting-thr_k"), "a helper that needs you is an open question too");
  assert.match(textOf(find(root, "row-overview-decision-m_d")), /You, 11:48 PM/, "a decision says who and when");
  assert.match(textOf(find(root, "row-overview-question-m_q")), /Kai/, "a question says who asked");
  assert.ok(!JSON.stringify(find(root, "row-overview-jump-m_r")).includes("svg"), "jump rows are plain, no flag");
  await press(find(root, "row-overview-helper-thr_o"));
  await press(find(root, "row-overview-jump-m_r"));
  await press(find(root, "row-overview-question-m_q"));
  await press(find(root, "row-overview-decision-m_d"));
  assert.deepEqual(log, ["helper:thr_o", "jump:m_r", "jump:m_q", "jump:m_d"]);
});

test("the Overview leaves out a section with nothing in it", async () => {
  const root = await mount(createRoot, <OverviewView goal="" summary={summary({ firstAsk: "", from: 0, to: 0 })} members={[]} context={null} clock={() => ""} onHelper={() => undefined} onJump={() => undefined} />);
  const text = textOf(find(root, "session-overview"));
  assert.equal(text.trim(), "");
});

test("files are listed once with the helper that touched them; a waiting helper is named with what it asked", () => {
  const two = [M({ id: "a", name: "Tess", files: [{ path: "x/a.ts", added: 1, deleted: 0 }] }), M({ id: "b", name: "Orin", files: [{ path: "x/a.ts", added: 2, deleted: 0 }, { path: "x/b.ts", added: 1, deleted: 1 }] })];
  assert.deepEqual(filesOf(two).map((f) => `${f.path}:${f.by}`), ["x/a.ts:Tess", "x/b.ts:Orin"]);
  assert.deepEqual(waitingOf(crew()), [{ id: "thr_k", text: "Asked you: 12 px or 14 px corners", who: "Kai" }]);
});

test("the session context: the conversation publishes, the pane reads, a jump from the pane reaches the chat, and a new chat starts empty", async () => {
  const seen: Array<string | boolean> = [];
  function Chat(): null { const s = useSession(); s?.onJump((id) => seen.push(`jump:${id}`)); return null; }
  function Pane(): null { const s = useSession(); seen.push(s?.summary.long ?? "none"); return null; }
  let api: ReturnType<typeof useSession> = null;
  function Grab(): null { api = useSession(); return null; }
  const root = createRoot();
  await act(async () => { root.render(<SessionProvider threadId="thr_1"><Chat /><Pane /><Grab /></SessionProvider>); });
  assert.equal(seen[0], false);
  await act(async () => { api!.publish(summary()); });
  assert.equal(seen[seen.length - 1], true);
  api!.jump("m_7");
  assert.ok(seen.includes("jump:m_7"));
  const before = seen.length;
  await act(async () => { api!.publish(summary()); });
  assert.equal(seen.length, before, "the same summary changes nothing");
  await act(async () => { root.render(<SessionProvider threadId="thr_2"><Chat /><Pane /><Grab /></SessionProvider>); });
  assert.equal(seen[seen.length - 1], false);
});

test("a crew row shows a clock only while it runs, in the app's duration words, even when its start is days old", async () => {
  const old = Date.now() - 378 * 86_400_000;
  const rows = [M({ id: "thr_r", state: "working", startedAt: old, elapsedMs: 0 }), M({ id: "thr_d", state: "done", startedAt: old, elapsedMs: 5_000, endedAt: old + 5_000 }), M({ id: "thr_n", state: "needs_you", startedAt: old, elapsedMs: 0 })];
  const root = await mount(createRoot, <CrewBlock members={rows} totals={T()} onPeek={() => undefined} />);
  assert.equal(textOf(find(root, "crew-chip-thr_r-time")).trim(), "378 d");
  assert.equal(textOf(find(root, "crew-chip-thr_d-time")).trim(), "", "a finished helper shows no clock");
  assert.equal(textOf(find(root, "crew-chip-thr_n-time")).trim(), "");
  assert.ok(!/\d:\d\d/.test(textOf(root)), "never a clock like 9073:44:02");
});

test("the Overview never prints an id, and a helper that waits on you is not listed again when its own question is", async () => {
  const kai = M({ id: "thr_k", name: "Kai", agentId: "agt_kai", state: "needs_you", step: "Asked you: 12 px or 14 px corners" });
  const s = summary({ questions: [{ messageId: "m_q", text: "Which corner radius?", by: "agt_kai" }], decisions: [{ messageId: "m_d", kind: "decision", label: "Decision", sub: "Ship it", at: 1000, by: "usr_x" }] });
  const root = await mount(createRoot, <OverviewView goal="g" summary={s} members={[kai]} context={null} clock={() => "9:20 PM"} who={(id) => (id === "agt_kai" ? "Kai" : id)} onHelper={() => undefined} onJump={() => undefined} />);
  assert.equal(find(root, "row-overview-waiting-thr_k"), null, "one question, listed once");
  assert.match(textOf(find(root, "row-overview-question-m_q")), /Kai/);
  const dec = textOf(find(root, "row-overview-decision-m_d"));
  assert.ok(dec.includes("9:20 PM") && !dec.includes("usr_x"), "an unresolved id reads as nothing");
});
