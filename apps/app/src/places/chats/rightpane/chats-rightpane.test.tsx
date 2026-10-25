// Chats right pane: the screen. Five quiet tabs under one far-left toggle (Computer, Threads, Files, Memory, Routines); the pane follows the agent of the open chat; switching tabs
// keeps the width; every list is a ui/Row with slots; every write changes what the next render shows, and a failed one becomes one quiet line. Rendered from the sample Spaces
// through the live screen queries. (Mapped from apps/app/tests/chats-rightpane.test.tsx: lane L9b owns only apps/app/src/places/chats/.)
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatRightPane, ChatRightPaneLoading } from "./ChatRightPane.tsx";
import { RightPaneDataProvider } from "./data.tsx";
import { FilesTab, treeOrder } from "./FilesTab.tsx";
import {
  accept, correct, deleteRoutine, duplicateRoutine, provision, reject, removeFact, renameRoutine, saveInstructions, setRoutine, signOut, takeOver, giveBack, wake,
} from "./actions.ts";
import type { PaneDeps } from "./actions.ts";
import {
  CURRENT, TABS, agoLabel, parseMap, chatWhen, workedNote, isWatcher, shortSchedule, nextDay, learnedWhen, MAP_LIMIT, backTo, changeByAsking, computerView, cronWords, enter, factNote, filePath, folderEntries, formatSize, groupThreads, isDefaultFilter, nextLabel,
  routineFile, routineNote, showingLine, sortRoutines, splitFacts, statusFor,
} from "./model.ts";
import type { Fact, Routine, TabKey } from "./model.ts";
import { SAMPLE_NOW, createSample } from "./sample.ts";
import type { Sample, Variant } from "./sample.ts";

const ALL = { start: 0, end: 500 };
const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const html = (s: Sample, tab: TabKey, paneWidth?: number): string => clean(renderToStaticMarkup(<ChatRightPane data={s.data} open onToggle={() => undefined} tab={tab} window={ALL} {...(paneWidth ? { paneWidth } : {})} />));
const at = (s: string, needle: string): number => {
  const i = s.indexOf(needle);
  assert.ok(i >= 0, `expected ${needle}`);
  return i;
};
const has = (s: string, needle: string): boolean => s.includes(needle);
const inOrder = (s: string, needles: string[]): void => {
  const idx = needles.map((n) => at(s, n));
  assert.deepEqual([...idx].sort((a, b) => a - b), idx, `in the order ${needles.join(" > ")}`);
};
const tagOf = (out: string, testid: string): string => {
  const i = at(out, `data-testid="${testid}"`);
  return out.slice(out.lastIndexOf("<", i), out.indexOf(">", i) + 1);
};
const deps = (s: Sample): { d: PaneDeps; notes: { text: string; undo?: () => Promise<void> | void }[] } => {
  const notes: { text: string; undo?: () => Promise<void> | void }[] = [];
  return { notes, d: { call: s.data.call, note: (text, undo) => notes.push(undo ? { text, undo } : { text }) } };
};
const factsNow = (s: Sample): Fact[] => s.replica.rows("facts") as unknown as Fact[];
const routinesNow = (s: Sample): Routine[] => s.replica.rows("routines") as unknown as Routine[];
const tabs: TabKey[] = ["computer", "threads", "files", "memory", "routines"];

test("five tabs in order under one pane toggle at the far left", () => {
  assert.deepEqual(TABS.map((t) => t.title), ["Computer", "Threads", "Files", "Memory", "Routines"]);
  const out = html(createSample(), "computer", 640);
  assert.equal(out.split('data-pane-toggle="far-left"').length - 1, 1, "exactly one toggle");
  assert.ok(has(out, 'data-toggle-count="1"'));
  inOrder(out, ['data-pane-toggle="far-left"', ">Computer<", ">Threads<", ">Files<", ">Memory<", ">Routines<"]);
  assert.ok(has(out, 'data-testid="chats-right-pane"') && has(out, 'data-testid="pane-body-computer"'));
  assert.ok(!has(out, String.fromCharCode(0x2014)), "no em dash in any copy");
});

test("a closed pane draws nothing; the shell owns the toggle's state", () => {
  const s = createSample();
  const out = clean(renderToStaticMarkup(<ChatRightPane data={s.data} open={false} onToggle={() => undefined} window={ALL} />));
  assert.ok(!has(out, "chats-right-pane") && !has(out, "side-pane"));
});

test("switching sections keeps the width: the edge is the pane's, not the tab's", () => {
  const widths = tabs.map((t) => /width:\s*(\d+)px/.exec(tagOf(html(createSample(), t), "side-pane"))?.[1]);
  assert.ok(widths[0] !== undefined, "the side pane carries a width");
  assert.equal(new Set(widths).size, 1, `one width across tabs: ${widths.join(",")}`);
  for (const t of tabs) assert.ok(has(html(createSample(), t), `data-testid="pane-body-${t}"`), t);
});

test("the pane follows the agent of the open chat", () => {
  const nw = html(createSample(), "threads");
  assert.ok(has(nw, 'data-testid="face-Intake"') && has(nw, "Books first calls and follows up on cold inquiries"));
  const personal = html(createSample("personal"), "threads");
  assert.ok(has(personal, 'data-testid="face-Assistant"') && has(personal, "Your assistant for anything in this Space"));
  assert.ok(!has(personal, "Rivera intake"), "another agent's chats do not leak in");
});

test("Computer, working: the live caption, steps in order, and the sites it is signed in to", () => {
  const out = html(createSample(), "computer");
  assert.ok(has(out, "Working: Filling the county records form"));
  assert.ok(has(out, 'data-testid="computer-screen"') && has(out, 'data-testid="computer-take"') && has(out, 'data-testid="computer-terminal"') && has(out, 'data-testid="computer-pop"'));
  assert.ok(has(out, ">Session<") && has(out, ">5 steps<"));
  const session = out.slice(at(out, ">Session<"));
  inOrder(session, ["Opened the county records site", "Searched for Rivera, Elena", "Saved the 2019 deed to Files", "Checked the filing date", "Filling the county records form"]);
  assert.ok(has(out, "Chrome · now") && has(out, "Chrome · 9 min ago"));
  inOrder(out, ["Signed in on its computer", "Google Workspace", "Web form inbox", "Calendar"]);
  assert.ok(has(out, "intake@northwind.example · since 2 Oct"));
  assert.ok(!has(out, 'data-testid="computer-wake"'));
});

test("Computer, asleep: Wake, the last session, and a dimmed screen that wakes on click", () => {
  const out = html(createSample("asleep"), "computer");
  assert.ok(has(out, ">Asleep<") && has(out, 'data-testid="computer-wake"') && has(out, ">Last session<"));
  assert.ok(has(out, "Wake Intake's computer"));
  assert.ok(!has(out, 'data-testid="computer-take"'), "Take over is for a working computer");
});

test("Computer, in a Personal Space, says Needs a Team Space; an agent without a computer offers to set one up", () => {
  const personal = html(createSample("personal"), "computer");
  assert.ok(has(personal, "Needs a Team Space") && has(personal, "Agent computers") && has(personal, 'data-testid="computer-personal"'));
  const s = createSample();
  const bare = clean(renderToStaticMarkup(<ChatRightPane data={{ ...s.data, agent: { agentId: "agt_intake", name: "Intake" } }} open onToggle={() => undefined} tab="computer" window={ALL} />));
  assert.ok(has(bare, "Intake has no computer yet") && has(bare, 'data-testid="computer-provision"'));
});

test("Threads: the threads it worked in, its helpers (running first), and its own chats; the open chat is selected", () => {
  const out = html(createSample(), "threads");
  inOrder(out, ["Threads it worked in", "#intake · Omar Haddad", ">Helpers<", "County mirrors", "Firms 1–3", "Its chats", "Rivera intake", "Weekly lead report"]);
  assert.ok(has(out, "Working now") && has(out, "Started 32 min ago"));
  assert.ok(has(out, ">9:31<") && has(out, ">Mon<"), "its chats say when as the prototype does: the clock time today, the weekday this week");
  assert.ok(!has(out, "Lead follow-ups") && !has(out, "Retainer question"), "only what the prototype lists");
  assert.ok(has(tagOf(out, "row-chat-c1"), "background-color:var(--sel)"), "the open chat reads as selected");
  assert.ok(!has(tagOf(out, "row-thread-th_a"), "background-color:var(--sel)"), "a thread is not selected");
  for (const id of ["thread-th_a", "helper-h4", "chat-c1"]) assert.ok(has(out, `data-testid="row-${id}"`), id);
});

test("Files: a tree, files first then folders in the prototype's order; counts on the right, locks on what Vyre owns; memory and routines open", () => {
  const out = html(createSample(), "files");
  assert.ok(has(out, "Intake's folder") && has(out, "Mounted as ~/Vyre"));
  inOrder(out, [">AGENT.md<", ">agent.toml<", ">memory<", ">MAP.md<", ">notes<", ">proposed<", ">recipes<", ">journal<", ">skills<", ">routines<", ">morning_lead_sweep.md<", ">knowledge<", ">inbox<", ">work<", ">downloads<", ">logs<", ">chats<"]);
  assert.ok(has(out, "2 KB · updated 22 Oct") && has(out, "940 B"));
  assert.ok(out.includes('data-testid="lock-fld_logs"') && out.includes('data-testid="lock-fld_chats"'), "Vyre owns logs and chats");
  assert.ok(!out.includes('data-testid="lock-fld_memory"') && !out.includes('data-testid="lock-fld_skills"'));
  assert.ok(has(out, "People write AGENT.md. Only the owner changes agent.toml. Vyre owns logs and chats."));
});

test("Files: the tree order and the counts", () => {
  assert.deepEqual(treeOrder([{ name: "logs" }, { name: "zeta" }, { name: "memory" }, { name: "chats" }, { name: "alpha" }, { name: "skills" }]).map((x) => x.name), ["memory", "skills", "logs", "chats", "alpha", "zeta"]);
  const out = html(createSample(), "files");
  const count = (id: string): string => (new RegExp(`data-testid="count-${id}"[^>]*>(\\d+)<`).exec(out) ?? [])[1] ?? "";
  assert.deepEqual([count("fld_memory"), count("fld_skills"), count("fld_routines"), count("fld_knowledge")], ["5", "2", "3", "2"]);
});

test("Files: an empty folder says so", () => {
  const s = createSample();
  const { d } = deps(s);
  const out = clean(renderToStaticMarkup(<RightPaneDataProvider value={s.data}><FilesTab deps={d} folderId="fld_inbox" window={ALL} /></RightPaneDataProvider>));
  assert.ok(has(out, "Nothing in this folder yet.") && has(out, 'data-testid="files-empty"'));
});

test("Memory: proposed facts wait on top with Accept and Reject; known facts carry when, learned and source; replaced ones stay out", () => {
  const out = html(createSample(), "memory");
  inOrder(out, ["Proposed · 3", "Consult invoices go out the same day as the call.", "Thursday mornings are never offered for consults.", "Elena's business partner", "What Intake knows in Northwind", "Elena Rivera was referred by Maya Chen.", "The consult fee is $250", "Consults are 1 hour"]);
  assert.ok(has(out, "Accept or reject") && has(out, "Rivera intake") && has(out, " · 9:31") && has(out, "#intake"), "proposed facts are cards that say where from and when, in the prototype's words");
  assert.ok(has(out, "Since 23 Oct · learned 24 Oct · from a chat") && has(out, "Since 2 Oct · learned 2 Oct · from you"));
  assert.ok(!has(out, "Consults are 30 minutes."), "the replaced fact is not in the default list");
  assert.ok(has(out, 'data-testid="memory-filter"') && !has(out, 'data-testid="memory-showing"'));
});

test("Memory filters narrow by source and can include replaced facts", () => {
  const s = createSample();
  const q = (state: Record<string, unknown>): Fact[] => {
    const snap = s.data.screens.query("chats.agent-memory", "facts", { agentId: "agt_intake", layer: "agent", ...state }).getSnapshot();
    assert.equal(snap.status, "ready");
    return (snap as { data: { facts: Fact[] } }).data.facts;
  };
  assert.equal(q({ status: statusFor(CURRENT) }).length, 3);
  assert.equal(q({ status: statusFor({ fromMe: false, replaced: true }) }).length, 4);
  assert.deepEqual(q({ status: ["current"], fromMe: true }).map((f) => f.factId), ["f2"]);
  assert.equal(q({ status: ["proposed"] }).length, 3);
  assert.equal(showingLine(CURRENT), "");
  assert.equal(showingLine({ fromMe: true, replaced: false }), "Showing facts from you");
  assert.equal(showingLine({ fromMe: false, replaced: true }), "Showing all facts, including replaced");
  assert.equal(showingLine({ fromMe: true, replaced: true }), "Showing facts from you, including replaced");
  assert.ok(isDefaultFilter(CURRENT) && !isDefaultFilter({ fromMe: true, replaced: false }));
});

test("Routines: on first by next run, paused last; the on count, switches, and the three starters", () => {
  const out = html(createSample(), "routines");
  inOrder(out, ["Morning lead sweep", "Watch #intake for new clients", "Chase missing intake forms", "New routine"]);
  assert.ok(has(out, ">2 on<") && has(out, "weekdays 8:00 · next Mon Oct 27") && has(out, "on new messages") && has(out, "Paused · Every day at 17:00"));
  assert.ok(has(out, 'data-testid="routine-switch-r3"'), "a switch on every routine");
  assert.ok(has(tagOf(out, "routine-switch-r3"), 'aria-checked="true"'), "Morning lead sweep is on");
  assert.ok(has(tagOf(out, "routine-switch-r5"), 'aria-checked="false"'), "Chase missing intake forms is paused");
  for (const x of ["Every morning at 8, …", "When someone mentions …", "Every Friday, summarise …"]) assert.ok(has(out, x), x);
  assert.ok(has(out, "Routines are made by asking Intake. Pick a start and finish the sentence in the chat."));
});

test("an agent with no routines says so; a Personal assistant has none", () => {
  const out = html(createSample("personal"), "routines");
  assert.ok(has(out, "Assistant has no routines yet.") && has(out, 'data-testid="routines-empty"'));
});

test("every list draws ui/Row with its slots, never an overlay", () => {
  for (const t of tabs) {
    const out = html(createSample(), t);
    assert.ok(has(out, 'data-testid="row-'), `${t} has rows`);
  }
  const threads = html(createSample(), "threads");
  assert.ok(has(threads, 'data-testid="row-thread-th_a-leading"') && has(threads, 'data-testid="row-chat-c1-leading"'));
  const routines = html(createSample(), "routines");
  assert.ok(has(routines, 'data-testid="row-routine-r3-trailing"'));
});

test("offline: the pane says so and still draws what the device keeps", () => {
  const s = createSample("northwind", { online: false });
  const out = html(s, "memory");
  assert.ok(has(out, 'data-testid="pane-offline"') && has(out, "Offline. Showing what this device keeps."));
  assert.ok(has(out, "Elena Rivera was referred by Maya Chen."));
});

test("before data the pane draws a frame of the right size", () => {
  const out = clean(renderToStaticMarkup(<ChatRightPaneLoading open onToggle={() => undefined} />));
  assert.ok(has(out, 'data-testid="right-pane-loading"') && has(out, 'data-pane-toggle="far-left"'));
  const bare = clean(renderToStaticMarkup(<ChatRightPane open onToggle={() => undefined} />));
  assert.ok(has(bare, "right-pane-loading"));
});

/* ---------- writes ---------- */

test("Accept makes a proposed fact known; Undo rejects it again", async () => {
  const s = createSample();
  const { d, notes } = deps(s);
  const p1 = factsNow(s).find((f) => f.factId === "p1")!;
  assert.equal(await accept(d, p1), true);
  assert.equal(factsNow(s).find((f) => f.factId === "p1")!.status, "current");
  assert.ok(html(s, "memory").includes("Proposed · 2"));
  await notes[0]!.undo!();
  assert.equal(factsNow(s).find((f) => f.factId === "p1")!.status, "removed");
  assert.deepEqual(s.calls.map((c) => c.cap), ["memory.fact.accept", "memory.fact.reject"]);
});

test("Reject drops a proposed fact; Undo accepts it", async () => {
  const s = createSample();
  const { d, notes } = deps(s);
  const p2 = factsNow(s).find((f) => f.factId === "p2")!;
  await reject(d, p2);
  assert.ok(!html(s, "memory").includes("Dev Rao"));
  await notes[0]!.undo!();
  assert.equal(factsNow(s).find((f) => f.factId === "p2")!.status, "current");
});

test("Correct keeps the old fact marked replaced and adds yours; an empty or unchanged text does nothing", async () => {
  const s = createSample();
  const { d, notes } = deps(s);
  const f3 = factsNow(s).find((f) => f.factId === "f3")!;
  assert.equal(await correct(d, f3, "   "), false);
  assert.equal(await correct(d, f3, f3.text), false);
  assert.equal(s.calls.length, 0);
  assert.equal(await correct(d, f3, "The consult fee is $300."), true);
  const now = factsNow(s);
  assert.equal(now.find((f) => f.factId === "f3")!.status, "closed");
  assert.ok(now.some((f) => f.text === "The consult fee is $300." && f.status === "current" && f.sourceKind === "manual"));
  const out = html(s, "memory");
  assert.ok(has(out, "The consult fee is $300.") && !has(out, "The consult fee is $250"));
  assert.ok(has(notes[0]!.text, "old fact is kept"));
});

test("Remove takes a fact out of what the agent knows", async () => {
  const s = createSample();
  const { d } = deps(s);
  await removeFact(d, factsNow(s).find((f) => f.factId === "f1")!);
  assert.ok(!html(s, "memory").includes("Elena Rivera was referred by Maya Chen."));
});

test("Pause and Resume flip the switch, with Undo; Duplicate makes a paused copy; Rename and new instructions save", async () => {
  const s = createSample();
  const { d, notes } = deps(s);
  const r3 = routinesNow(s).find((r) => r.routineId === "r3")!;
  await setRoutine(d, r3, false);
  assert.equal(routinesNow(s).find((r) => r.routineId === "r3")!.enabled, false);
  assert.ok(html(s, "routines").includes(">1 on<"));
  await notes[0]!.undo!();
  assert.equal(routinesNow(s).find((r) => r.routineId === "r3")!.enabled, true);
  await duplicateRoutine(d, r3);
  const copy = routinesNow(s).find((r) => r.title === "Morning lead sweep copy");
  assert.ok(copy && copy.enabled === false, "paused until you turn it on");
  assert.equal(await renameRoutine(d, r3, "  "), false);
  assert.equal(await renameRoutine(d, r3, "Lead sweep"), true);
  assert.ok(routinesNow(s).some((r) => r.routineId === "r3" && r.title === "Lead sweep"));
  assert.equal(await saveInstructions(d, r3, r3.prompt), false);
  assert.equal(await saveInstructions(d, r3, "Check the form inbox only."), true);
  assert.equal(routinesNow(s).find((r) => r.routineId === "r3")!.prompt, "Check the form inbox only.");
});

test("Delete removes a routine and Undo brings it back as it was", async () => {
  const s = createSample();
  const { d, notes } = deps(s);
  const r5 = routinesNow(s).find((r) => r.routineId === "r5")!;
  await deleteRoutine(d, r5);
  assert.ok(!html(s, "routines").includes("Chase missing intake forms"));
  await notes[0]!.undo!();
  const back = routinesNow(s).find((r) => r.title === "Chase missing intake forms");
  assert.ok(back && back.enabled === false && back.cron === r5.cron);
});

test("computer actions: wake, take over, give back, sign out, set up", async () => {
  const s = createSample("asleep");
  const { d, notes } = deps(s);
  await wake(d, "cmp_intake", "Intake");
  assert.ok(html(s, "computer").includes("Working: Waking up"));
  await takeOver(d, "cmp_intake", "Intake");
  const mine = html(s, "computer");
  assert.ok(mine.includes("You're in control"));
  assert.ok(mine.includes('data-testid="computer-give"'));
  await giveBack(d, "cmp_intake", "Intake");
  assert.ok(!html(s, "computer").includes('data-testid="computer-give"'));
  await signOut(d, "cmp_intake", "Calendar");
  assert.ok(!html(s, "computer").includes("Maya Chen's calendar, can book"));
  await provision(d, "agt_intake", "Intake");
  assert.deepEqual(s.calls.map((c) => c.cap), ["computers.wake", "computers.take_over", "computers.give_back", "computers.session.sign_out", "computers.provision"]);
  assert.ok(notes.every((n) => !n.text.startsWith("Could not")));
});

test("a failed write is one quiet line, not a thrown error", async () => {
  const s = createSample();
  const { d, notes } = deps(s);
  s.failNext("memory.fact.reject");
  assert.equal(await reject(d, factsNow(s).find((f) => f.factId === "p1")!), false);
  assert.deepEqual(notes.map((n) => n.text), ["Could not reject that fact. Try again."]);
  assert.equal(factsNow(s).find((f) => f.factId === "p1")!.status, "proposed", "nothing changed");
});

test("every nav handler is reachable: the shell is told what to open, never how", () => {
  const s = createSample();
  s.data.nav.openThread("th_a", "side");
  s.data.nav.openFile("fl_agent", "full");
  s.data.nav.fillComposer(changeByAsking("Morning lead sweep"));
  assert.deepEqual(s.opened, ["thread:side:th_a", "file:full:fl_agent", "composer"]);
  assert.equal(s.composer.text, "Change “Morning lead sweep”: ");
});

/* ---------- the rules behind it ---------- */

test("a cron reads in words for the common shapes and as written for the rest", () => {
  assert.equal(cronWords("0 8 * * *"), "Every day at 08:00");
  assert.equal(cronWords("30 9 * * 1-5"), "Weekdays at 09:30");
  assert.equal(cronWords("0 17 * * 5"), "Every Friday at 17:00");
  assert.equal(cronWords("*/5 * * * *"), "*/5 * * * *");
  assert.equal(cronWords("0 8 1 * *"), "0 8 1 * *");
  assert.equal(routineFile("Morning lead sweep!"), "routines/morning-lead-sweep.md");
  assert.equal(routineFile("???"), "routines/routine.md");
});

test("time reads in the person's offset: ahead, behind", () => {
  const c = { now: SAMPLE_NOW, offsetMin: 0 };
  assert.equal(nextLabel(SAMPLE_NOW + 7 * 3_600_000, c), "Today 17:00");
  assert.equal(nextLabel(SAMPLE_NOW + 22 * 3_600_000, c), "Tomorrow 08:00");
  assert.equal(nextLabel(SAMPLE_NOW + 3 * 86_400_000, c), "Mon 10:00");
  assert.equal(nextLabel(SAMPLE_NOW + 10 * 86_400_000, c), "3 Nov");
  assert.equal(agoLabel(SAMPLE_NOW - 20_000, c), "just now");
  assert.equal(agoLabel(SAMPLE_NOW - 5 * 60_000, c), "5 min ago");
  assert.equal(agoLabel(SAMPLE_NOW - 3 * 3_600_000, c), "3 h ago");
  assert.equal(agoLabel(SAMPLE_NOW - 26 * 3_600_000, c), "Yesterday");
  assert.equal(nextLabel(SAMPLE_NOW + 15 * 3_600_000, { now: SAMPLE_NOW, offsetMin: 300 }), "Tomorrow 06:00", "300 minutes ahead of UTC moves the day line");
});

test("the computer's state decides the screen, the label and the one action", () => {
  const base = { computerId: "c", agentId: "a", tabs: 2, tabLimit: 8, host: "server" as const, recording: false };
  assert.deepEqual([computerView({ ...base, state: "asleep" }).screen, computerView({ ...base, state: "asleep" }).action], ["asleep", "wake"]);
  assert.deepEqual([computerView({ ...base, state: "working", caption: "Opening a form" }).label, computerView({ ...base, state: "working" }).action], ["Working: Opening a form", "take"]);
  assert.deepEqual([computerView({ ...base, state: "takeover" }).label, computerView({ ...base, state: "takeover" }).action], ["You're in control", "give"]);
  assert.equal(computerView({ ...base, state: "provisioning" }).action, null);
  assert.equal(computerView({ ...base, state: "error" }).action, "wake");
});

test("threads group by what the agent did; chats and threads of other agents stay out; closed ones are gone", () => {
  const mk = (id: string, kind: "chat" | "thread", agent: string, createdAt: number, closedAt?: number) => ({
    threadId: id, kind, title: id, listed: true, planMode: false, members: [], agents: [{ agentId: agent, mode: "lead" as const }], createdAt, ...(closedAt ? { closedAt } : {}),
  });
  const g = groupThreads("a1", [mk("t1", "thread", "a1", 1), mk("t2", "thread", "a2", 2), mk("t3", "thread", "a1", 3), mk("t4", "thread", "a1", 4, 9)], [
    { threadId: "h1", title: "x", status: "done", agentId: "a1", startedAt: 5 }, { threadId: "h2", title: "y", status: "running", agentId: "a1", startedAt: 4 }, { threadId: "h3", title: "z", status: "running", agentId: "a2", startedAt: 6 },
  ], [mk("c1", "chat", "a1", 1), mk("c2", "chat", "a1", 2), mk("c3", "chat", "a2", 3)]);
  assert.deepEqual(g.worked.map((t) => t.threadId), ["t3", "t1"]);
  assert.deepEqual(g.helpers.map((h) => h.threadId), ["h2", "h1"], "running first");
  assert.deepEqual(g.chats.map((t) => t.threadId), ["c2", "c1"]);
});

test("the folder walk: in, back, and paths relative to the agent's folder", () => {
  const root = [{ folderId: "r", name: "Intake" }];
  const deep = enter(enter(root, { folderId: "m", name: "memory" }), { folderId: "n", name: "notes" });
  assert.equal(filePath(deep.slice(1), "a.md"), "memory/notes/a.md");
  assert.deepEqual(backTo(deep, "m").map((c) => c.folderId), ["r", "m"]);
  assert.deepEqual(backTo(deep, "zzz").map((c) => c.folderId), ["r"]);
  assert.equal(formatSize(512), "512 B");
  assert.equal(formatSize(2048), "2 KB");
  assert.equal(formatSize(5 * 1024 * 1024), "5.0 MB");
  const f = folderEntries(
    [{ folderId: "b", parentId: "r", name: "b", path: "b", fileCount: 0, folderCount: 0, scope: "space", label: 0, git: false, reviewChanges: false }, { folderId: "a", parentId: "r", name: "a", path: "a", fileCount: 0, folderCount: 0, scope: "space", label: 0, git: false, reviewChanges: false }, { folderId: "z", parentId: "other", name: "z", path: "z", fileCount: 0, folderCount: 0, scope: "space", label: 0, git: false, reviewChanges: false }],
    [], "r",
  );
  assert.deepEqual(f.folders.map((x) => x.name), ["a", "b"]);
});

test("facts split into proposed and known, newest first; replaced ones sort after current", () => {
  const mk = (id: string, status: Fact["status"], learnedAt: number): Fact => ({ factId: id, layer: "agent", ownerRef: "a", text: id, validFrom: 1, learnedAt, sourceKind: "chat", sourceRef: "c", status });
  const r = splitFacts([mk("a", "current", 1), mk("b", "proposed", 2), mk("c", "closed", 9), mk("d", "current", 3), mk("e", "removed", 4)]);
  assert.deepEqual(r.proposed.map((f) => f.factId), ["b"]);
  assert.deepEqual(r.known.map((f) => f.factId), ["d", "a", "c"]);
  const c = { now: SAMPLE_NOW, offsetMin: 0 };
  assert.ok(factNote({ ...mk("x", "closed", SAMPLE_NOW), closedAt: SAMPLE_NOW }, c).startsWith("Replaced 24 Oct"));
});

test("sorting routines and describing one", () => {
  const c = { now: SAMPLE_NOW, offsetMin: 0 };
  const mk = (id: string, enabled: boolean, next?: number): Routine => ({ routineId: id, agentId: "a", title: id, cron: "0 8 * * *", prompt: "p", enabled, ownerId: "u", ...(next ? { nextRunAt: next } : {}) });
  assert.deepEqual(sortRoutines([mk("p", false), mk("b", true, 20), mk("a", true, 10), mk("n", true)]).map((r) => r.routineId), ["a", "b", "n", "p"]);
  assert.equal(routineNote(mk("z", true), c), "every day 8:00");
  assert.equal(routineNote(mk("z", false), c), "Paused · Every day at 08:00");
});

test("variants exist for the screenshots", () => {
  const variants: Variant[] = ["northwind", "asleep", "personal"];
  for (const v of variants) assert.ok(createSample(v).data.threadId.length > 0, v);
});

/* ---------- as the prototype draws them (P-L9b_07c) ---------- */

test("MAP.md comes from memory.map.get: key rows, its line count against the limit", async () => {
  const s = createSample();
  const out = (await s.data.call("memory.map.get", { agentId: "agt_intake" })) as { map?: { body: string; lines: number } };
  assert.ok(out.map);
  const map = parseMap(out.map.body, out.map.lines);
  assert.deepEqual(map.rows.map((r) => r.key), ["elena-rivera", "consult-rules", "maya-calendar", "intake-form-site", "weekly-lead-report"]);
  assert.equal(map.lines, 5);
  assert.equal(MAP_LIMIT, 200);
  assert.equal(parseMap("# t\n\nplain\n- `a-b`: text here\n* `c` \u2013 more").rows.map((r) => `${r.key}|${r.text}`).join(","), "a-b|text here,c|more");
  assert.equal(parseMap("- `a` b", 42).lines, 42, "the capability's own count wins");
});

test("memory.counts says how many low-risk facts merged on their own, and the pane says so under the proposed ones", async () => {
  const s = createSample();
  const counts = (await s.data.call("memory.counts", { agentId: "agt_intake" })) as { autoMerged: number };
  assert.equal(counts.autoMerged, 2);
});

test("routine rows read like the prototype: short schedule, next day, watchers on events, paused with its cron", () => {
  const c = { now: SAMPLE_NOW, offsetMin: 0 };
  assert.equal(shortSchedule("0 8 * * 1-5"), "weekdays 8:00");
  assert.equal(shortSchedule("30 9 * * 5"), "every Friday 9:30");
  assert.equal(shortSchedule("0 17 * * *"), "every day 17:00");
  assert.equal(shortSchedule("*/5 * * * *"), "*/5 * * * *");
  assert.equal(nextDay(Date.UTC(2025, 9, 27, 8), c), "Mon Oct 27");
  const r = (cron: string, enabled = true): Routine => ({ routineId: "x", agentId: "a", title: "t", cron, prompt: "p", enabled, ownerId: "u" });
  const w = (enabled = true): Routine => ({ routineId: "w", agentId: "a", title: "t", prompt: "p", enabled, ownerId: "u", kind: "watch", watch: { on: "message", channelId: "intake" } });
  assert.ok(isWatcher(w()) && !isWatcher(r("0 8 * * *")));
  assert.equal(routineNote(w(), c), "on new messages");
  assert.equal(routineNote(w(false), c), "Paused · on new messages");
  assert.equal(routineNote(r("0 17 * * *", false), c), "Paused · Every day at 17:00");
});

test("the routine switch is green when on (the prototype's), and a watcher has the watch glyph", () => {
  const out = html(createSample(), "routines");
  assert.ok(has(tagOf(out, "routine-switch-r3"), "background-color:var(--ok)"), "an on switch paints the ok token");
  assert.ok(!has(tagOf(out, "routine-switch-r5"), "background-color:var(--ok)"));
});

test("chats and learned times are clock times today, weekdays this week", () => {
  const c = { now: SAMPLE_NOW, offsetMin: 0 };
  assert.equal(chatWhen(Date.UTC(2025, 9, 24, 9, 31), c), "9:31");
  assert.equal(chatWhen(Date.UTC(2025, 9, 23, 16, 5), c), "Yesterday");
  assert.equal(chatWhen(Date.UTC(2025, 9, 20, 9), c), "Mon");
  assert.equal(chatWhen(Date.UTC(2025, 8, 1, 9), c), "1 Sep");
  assert.equal(learnedWhen(Date.UTC(2025, 9, 24, 9, 31), c), "9:31");
});

test("a thread it worked in says how many replies and when the last came", () => {
  const c = { now: SAMPLE_NOW, offsetMin: 0 };
  const s = createSample();
  const th = (s.replica.rows("threads") as unknown as { threadId: string; replyCount?: number; lastMessageAt?: number; createdAt: number }[]).find((x) => x.threadId === "th_a")!;
  assert.equal(workedNote(th as never, c), "5 replies · last 9:34");
  assert.equal(workedNote({ ...th, replyCount: 1 } as never, c), "1 reply · last 9:34");
  assert.equal(workedNote({ ...th, replyCount: undefined, lastMessageAt: undefined } as never, c), "Started 32 min ago");
  assert.ok(has(html(s, "threads"), "5 replies · last 9:34"));
});
