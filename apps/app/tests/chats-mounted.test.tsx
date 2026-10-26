// P-L9b_23: the Chats place with every leftover screen mounted. The face, the helper icon, the channel menu and the Computer chip each end in the screen they name; the agent page,
// the helper chat, Needs you, the computer popup, the recording sheet, Connect an outside agent, All agents, the terminal tab, list and rules and the Waiting on line all draw
// from the runtime's screens and calls (a fake replica answers them), and the terminal's open, attach, input and resize drive ui/Terminal in order, every call checked against the
// frozen contract. The controls are pressed the way the screen presses them: through the nav the place hands each part, then the place is drawn on what that left shown.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { validateInput } from "../../../generated/validators.ts";
import { Terminal, TerminalFeed, hostMenu, keyToData } from "../../../ui/src/Terminal/index.tsx";
import type { TerminalFrame } from "../../../ui/src/Terminal/index.tsx";
import { PEOPLE, CHANNEL, COMPUTER, HELPER, RECORDING, SERVER_TERMINAL, TERMINAL, createMountSample } from "../src/places/chats/mounts/sample.ts";
import type { MountSample } from "../src/places/chats/mounts/sample.ts";
import { ChatsMounted } from "../src/places/chats/mounts/ChatsMounted.tsx";
import { AllAgents, pickAgents } from "../src/places/chats/mounts/AllAgents.tsx";
import type { AgentRow } from "../src/places/chats/mounts/AllAgents.tsx";
import { ConnectOutsideAgent, DEFAULT_SCOPES, SCOPE_ROWS, createConnection, maskCommand, maskToken, minutesLeft } from "../src/places/chats/mounts/ConnectOutsideAgent.tsx";
import { createGo, newKey, terminalData, wireConversation, wirePane, wireSidebar } from "../src/places/chats/mounts/data.ts";
import { START, fromHash, step } from "../src/places/chats/mounts/route.ts";
import type { Act, Shown } from "../src/places/chats/mounts/route.ts";
import { waitingWords, waitsOf } from "../src/places/chats/mounts/WaitingOn.tsx";
import { connectEntries } from "../src/places/chats/conversation/Conversation.tsx";
import { TerminalList } from "../src/places/chats/terminal/TerminalList.tsx";
import { TerminalRules } from "../src/places/chats/terminal/TerminalRules.tsx";
import { sessionProps } from "../src/places/chats/terminal/TerminalTab.tsx";
import { RULE_LISTS, ago, linesText, openCall, ordered, parseLines, pollSource, rulesProblem, sameRules, uiHost, uiState } from "../src/places/chats/terminal/model.ts";
import type { Rules, TerminalRow } from "../src/places/chats/terminal/model.ts";
import { askServerAccess, attach, createSender, openSession, saveRules, toggleStar } from "../src/places/chats/terminal/session.ts";
import { errorCode, isRefusal } from "../src/places/chats/mounts/live.ts";

const WINDOW = { start: 0, end: 500 };
const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const has = (s: string, needle: string): boolean => s.includes(needle);
const settle = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
const nameOf = (id: string): string => PEOPLE.find((p) => p.id === id)?.name ?? id;

/** The place drawn on what has been shown so far. */
const html = (s: MountSample, shown?: Shown, hash = ""): string =>
  clean(renderToStaticMarkup(<ChatsMounted rt={s.rt} {...(shown ? { initial: shown } : {})} {...(hash === "" ? {} : { hash })} window={WINDOW} />));

/** The place's doors over a recorder: every `act` the doors make, in order, and the lines the place would have said. */
function doors(s: MountSample): { go: ReturnType<typeof createGo>; acts: Act[]; said: string[]; shown: () => Shown } {
  const acts: Act[] = [];
  const said: string[] = [];
  const go = createGo(s.rt, (a) => void acts.push(a), nameOf, (t) => void said.push(t));
  return { go, acts, said, shown: () => acts.reduce(step, START) };
}

const conversation = (s: MountSample, go: ReturnType<typeof createGo>, threadId = "c1") =>
  wireConversation(s.rt, go, { threadId, list: PEOPLE, nameOf, leadId: "agt_intake" });

const caps = (s: MountSample): string[] => s.calls.map((c) => c.cap);
const contractErrors = (s: MountSample, only: (cap: string) => boolean): string[] => {
  const out: string[] = [];
  for (const c of s.calls) if (only(c.cap)) for (const e of validateInput(c.cap, 1, c.input)) out.push(`${c.cap}: ${e}`);
  return out;
};

/* ---------- the face, the helper icon, the channel menu, the Computer chip ---------- */

test("the face: the lead's face is in the header and its menu's Open Page shows the agent page with its tabs", () => {
  const s = createMountSample();
  const chat = html(s, step(START, { t: "chat", threadId: "c1" }));
  assert.ok(has(chat, 'data-testid="face-agt_intake"'), "the lead's face is a button in the header");
  assert.ok(!has(chat, 'data-testid="agent-page"'), "the chat is not the agent page");
  const { go, acts, shown } = doors(s);
  conversation(s, go).nav.openAgent("agt_intake");
  assert.deepEqual(acts, [{ t: "agent", agentId: "agt_intake" }]);
  const page = html(s, shown());
  assert.ok(has(page, 'data-testid="agent-page"') && has(page, "Intake, agent page"));
  for (const tab of ["Chats", "Memory", "Files", "Computer", "Settings"]) assert.ok(has(page, tab), `the ${tab} tab`);
  assert.ok(!has(page, 'data-testid="conversation"'), "the page replaces the chat in the middle");
});

test("the face: the agent page can be opened on a tab, as the pane and the sidebar do", () => {
  const s = createMountSample({ who: "owner" });
  const { go, acts, shown } = doors(s);
  wirePane(s.rt, go, "c1", { agentId: "agt_intake", name: "Intake", computerId: COMPUTER }).nav.openAgentPage("agt_intake");
  go.agent("agt_intake", "memory");
  assert.deepEqual(acts, [{ t: "agent", agentId: "agt_intake" }, { t: "agent", agentId: "agt_intake", tab: "memory" }]);
  const out = html(s, shown());
  assert.ok(has(out, 'data-testid="agent-page"'));
  assert.deepEqual(shown().route, { view: "agent", agentId: "agt_intake", tab: "memory" });
});

test("the helper icon: the header shows the running helpers and a helper from its menu opens as the read-only helper chat", async () => {
  const s = createMountSample();
  const chat = html(s, step(START, { t: "chat", threadId: "c1" }));
  assert.ok(has(chat, 'data-testid="helpers-button"'), "the helper icon shows while helpers run");
  const { go, acts, shown } = doors(s);
  conversation(s, go).nav.openThread(HELPER);
  await settle();
  assert.deepEqual(caps(s).filter((c) => c === "threads.get"), ["threads.get"], "the place asks what kind of thread it is");
  assert.deepEqual(acts, [{ t: "helper", threadId: HELPER }]);
  const out = html(s, shown());
  assert.ok(has(out, 'data-testid="helper-chat"') && has(out, 'data-testid="helper-address"'), "the helper chat with its address bar");
  assert.ok(has(out, "Firms 1"), "the helper's own title");
  // a thread that is not a helper stays a chat
  const other = doors(s);
  conversation(s, other.go).nav.openThread("c9");
  await settle();
  assert.deepEqual(other.acts, [{ t: "chat", threadId: "c9" }]);
});

test("the channel menu: Connect an Outside Agent is on a channel's menu only, and opens the sheet for that channel", () => {
  const s = createMountSample();
  const { go, acts, shown } = doors(s);
  const nav = conversation(s, go).nav;
  const entries = connectEntries({ kind: "channel", channelId: CHANNEL, threadId: "t_rivera" }, nav);
  assert.deepEqual(entries.map((e) => ("label" in e ? e.label : "")), ["Connect an Outside Agent"]);
  const first = entries[0];
  assert.ok(first && "onSelect" in first);
  first.onSelect?.();
  assert.deepEqual(acts, [{ t: "layer", layer: { kind: "connect", channelId: CHANNEL } }]);
  assert.deepEqual(connectEntries({ kind: "chat", threadId: "c1" }, nav), [], "a chat has no such entry");
  const { openConnectOutsideAgent: _gone, ...bare } = nav;
  assert.deepEqual(connectEntries({ kind: "channel", channelId: CHANNEL, threadId: "t_rivera" }, bare), [], "nor where the shell has no sheet");
  const out = html(s, shown());
  assert.ok(has(out, 'data-testid="connect-outside-agent"') && has(out, "rivera-matter") && has(out, "Create connection"));
});

test("the Computer chip: the chip is in the composer bar and opens the agent's computer popup over the chat", async () => {
  const s = createMountSample();
  const chat = html(s, step(START, { t: "chat", threadId: "c1" }));
  assert.ok(has(chat, 'data-testid="computer-button"'), "the Computer chip");
  const { go, acts, shown, said } = doors(s);
  conversation(s, go).nav.openBeside("computer", "agt_intake");
  await settle();
  assert.deepEqual(acts, [{ t: "layer", layer: { kind: "computer", computerId: COMPUTER, chat: false } }]);
  const out = html(s, shown());
  assert.ok(has(out, 'data-testid="computer-popup"') && has(out, "Intake's computer"), "the popup, with the agent's name");
  assert.ok(has(out, 'data-testid="rail-take"') && has(out, 'data-testid="rail-close"'));
  // an agent with no computer says so instead of opening nothing
  conversation(s, go).nav.openBeside("computer", "agt_docs");
  await settle();
  assert.deepEqual(said, ["Docs has no computer yet."]);
  // any other card still opens beside the chat through the shell
  conversation(s, go).nav.openBeside("file", "fil_1");
  assert.deepEqual(s.opened, [{ subject: { type: "file", id: "fil_1" } }]);
});

/* ---------- the pages and layers ---------- */

test("Needs you: the sidebar's Needs you opens the two-column page on a request", () => {
  const s = createMountSample();
  const { go, acts, shown } = doors(s);
  wireSidebar(s.rt, go).nav.openNeedsYou("n1");
  wireSidebar(s.rt, go).nav.openNeedsYou();
  assert.deepEqual(acts, [{ t: "needs", taskId: "n1" }, { t: "needs" }]);
  const out = html(s, step(START, { t: "needs", taskId: "n1" }));
  assert.ok(has(out, 'data-testid="needs-you"') && has(out, "Send 12 invoices"), "the list and the open request");
  assert.deepEqual(shown().route, { view: "needs", taskId: null });
  assert.ok(!has(out, 'data-testid="conversation"'));
});

test("All agents: the picker lists every agent under the control that opened it, finds by name, and a press opens the chat", async () => {
  const s = createMountSample();
  const { go, acts } = doors(s);
  wireSidebar(s.rt, go).nav.openAllAgents();
  assert.equal(acts.length, 1);
  const act = acts[0];
  assert.ok(act && act.t === "layer" && act.layer.kind === "all-agents" && typeof act.layer.x === "number" && typeof act.layer.y === "number", "it opens at a point under the control");
  const out = html(s, acts.reduce(step, START));
  assert.ok(has(out, 'data-testid="all-agents"') && has(out, 'aria-label="All agents"'));
  for (const n of ["Intake", "Docs", "Billing", "Research"]) assert.ok(has(out, `>${n}<`) || has(out, `aria-label="${n}"`), `${n} is listed`);
  assert.ok(has(out, 'data-testid="all-agents-search"'));
  const agent = (id: string, name: string, status: AgentRow["status"], role?: string): AgentRow => ({ agentId: id, name, face: name[0] ?? "", ...(role ? { role } : {}), status, ownerId: "usr_omar", folderId: "f", accountPolicy: "asker", toolsAllowed: [], toolsDenied: [], vaultKeys: [], limits: {}, captureMode: "propose", hasComputer: false, templateVersion: 1, createdAt: 1 });
  const all = [agent("a", "Docs", "awake", "Drafts letters"), agent("b", "Intake", "working", "Books consults"), agent("c", "Billing", "paused"), agent("d", "Archive", "asleep")];
  assert.deepEqual(pickAgents(all, "").map((a) => a.name), ["Intake", "Archive", "Docs", "Billing"], "working first, paused last, then by name");
  assert.deepEqual(pickAgents(all, "letters docs").map((a) => a.name), ["Docs"], "every word must match the name or the role");
  assert.deepEqual(pickAgents(all, "zzz"), []);
  // a press: the newest open chat the agent leads, else a new one
  go.agentChat("agt_docs");
  await settle(120);
  assert.deepEqual(caps(s).filter((c) => c === "threads.list" || c === "chat.start"), ["threads.list", "chat.start"]);
  const last = acts[acts.length - 1];
  assert.ok(last && last.t === "chat" && last.threadId.startsWith("th_"), "the chat that chat.start returned");
  assert.deepEqual(contractErrors(s, (c) => c === "chat.start" || c === "threads.list"), []);
  const picker = clean(renderToStaticMarkup(<AllAgents screens={s.rt.screens} space={{ name: "Northwind" }} x={8} y={48} onChat={() => undefined} onOpenPage={() => undefined} onNewAgent={() => undefined} onClose={() => undefined} window={WINDOW} />));
  assert.ok(has(picker, 'data-testid="all-agents-new"'), "New agent");
});

test("the recording sheet: a stopped recording opens the sheet that asks what the agent should do with it", () => {
  const s = createMountSample();
  const { go, acts } = doors(s);
  go.recording(RECORDING);
  assert.deepEqual(acts, [{ t: "layer", layer: { kind: "recording", recordingId: RECORDING } }]);
  const out = html(s, acts.reduce(step, START));
  assert.ok(has(out, 'data-testid="record-sheet"'), "the sheet");
  assert.ok(has(out, "Send to Intake") && has(out, "Save Only") && has(out, "Discard"));
  assert.ok(has(out, "Recording · 0:23") || has(out, "0:23"), "the length the recording holds");
  for (const key of ["make_skill", "learn_routine", "work_out_backend_calls", "learn_workflow"]) assert.ok(has(out, `data-testid="opt-${key}"`), key);
  assert.deepEqual(contractErrors(s, () => true), []);
});

test("Waiting on: an agent that waits on background work says so in the thread and wakes there; the line leaves when the wait ends", () => {
  const s = createMountSample();
  const quiet = html(s, step(START, { t: "chat", threadId: "c1" }));
  assert.ok(!has(quiet, "Waiting on:"), "no wait, no line");
  s.startWait("build 42");
  const out = html(s, step(START, { t: "chat", threadId: "c1" }));
  assert.ok(has(out, 'data-testid="waiting-on"'), "the line");
  assert.ok(has(out, "Waiting on: build 42. Intake wakes here when it is done."));
  const run = { id: "r", kind: "wait", name: "deploy to staging.", status: "waiting", startedAt: 1 } as const;
  assert.equal(waitingWords(run, "Docs"), "Waiting on: deploy to staging. Docs wakes here when it is done.");
  const base = { owner: "agt_intake", startedBy: "agt_intake", costMicros: 0, traceId: "t" } as const;
  const runs = [
    { ...base, id: "a", kind: "wait", status: "waiting", startedAt: 1 }, { ...base, id: "b", kind: "wait", status: "succeeded", startedAt: 2 },
    { ...base, id: "c", kind: "automation", status: "running", startedAt: 3 }, { ...base, id: "d", kind: "wait", status: "running", startedAt: 4 },
  ] as const;
  assert.deepEqual(waitsOf(runs).map((r) => r.id), ["d", "a"], "only waits that have not ended, newest first");
});

test("Connect an outside agent: the tool and what it may do, then the address, a masked one-time token and the command", async () => {
  const s = createMountSample();
  const sheet = clean(renderToStaticMarkup(<ConnectOutsideAgent screens={s.rt.screens} call={s.rt.call} newKey={() => "k1"} clock={s.rt.clock} channelId={CHANNEL} onClose={() => undefined} />));
  assert.ok(has(sheet, 'role="dialog"') && has(sheet, "Connect an outside agent") && has(sheet, "#rivera-matter"));
  for (const k of ["claude", "codex", "other"]) assert.ok(has(sheet, `data-testid="connect-kind-${k}"`), k);
  assert.ok(has(sheet, 'role="radiogroup"') && has(sheet, 'aria-checked="true"'), "a tool is chosen");
  assert.ok(has(sheet, "Never. Agents see handles, not values."), "the Vault is never offered");
  assert.deepEqual(SCOPE_ROWS.map((r) => [r.key, r.lock]), [["read", "on"], ["post", "on"], ["readChangesets", "on"], ["writeBranch", "free"], ["vault", "off"]]);
  assert.ok(has(sheet, 'data-testid="connect-create"') && !has(sheet, 'data-testid="connect-made"'), "nothing is made until Create connection");
  const made = await createConnection(s.rt.call, { channelId: CHANNEL, kind: "codex", scopes: { ...DEFAULT_SCOPES, writeBranch: true }, key: "k1" });
  assert.deepEqual(s.calls.map((c) => c.input), [{ channelId: CHANNEL, name: "Codex", scopes: { read: true, post: true, readChangesets: true, writeBranch: true }, idempotencyKey: "k1:codex:w" }]);
  assert.deepEqual(contractErrors(s, () => true), []);
  assert.ok(made.runCommand.startsWith("codex mcp add vyre ") && made.runCommand.includes(made.oneTimeToken));
  assert.equal(maskToken(made.oneTimeToken), `vyre_ot_${"•".repeat(24)}`);
  assert.ok(!maskCommand(made.runCommand, made.oneTimeToken).includes(made.oneTimeToken), "the command hides the token until Reveal");
  assert.equal(minutesLeft(s.rt.clock().now, made.expiresAt), 10);
  assert.equal(minutesLeft(made.expiresAt + 1, made.expiresAt), 0);
});

/* ---------- the terminal ---------- */

test("terminal golden step: open, attach, input, resize and live output drive ui/Terminal in order, every call inside the contract", async () => {
  const s = createMountSample();
  const deps = { call: s.rt.call, newKey };
  const row = await openSession(deps, "agent", { agentId: "agt_intake", computerId: "cmt_intake" });
  assert.equal(row.host, "agent_computer");
  assert.equal(uiHost(row.host), "agent");
  s.print(row.terminalId, "Welcome to Intake's computer\r\n\x1b[32m$\x1b[0m ");

  const att = await attach(deps, row.terminalId, 5);
  assert.ok(att.replay.includes("Welcome to Intake's computer"), "attach returns the scrollback");
  const screen = clean(renderToStaticMarkup(<Terminal {...sessionProps(row, { replay: att.replay, source: att.source, starred: false })} onStar={() => undefined} />));
  assert.ok(has(screen, "Welcome to Intake's computer"), "ui/Terminal draws the replay");
  assert.ok(has(screen, "Intake's computer · running") && has(screen, 'aria-label="Star"'), "the session line and the star");

  const failed: string[] = [];
  const sender = createSender(deps, row.terminalId, (w) => void failed.push(w));
  const keys = ["l", "s", "Enter"].map((key) => keyToData({ key }));
  assert.deepEqual(keys, ["l", "s", "\r"]);
  for (const k of keys) assert.equal(await sender.input(k ?? ""), true);
  assert.deepEqual(s.typed, ["l", "s", "\r"], "keys arrive in the order they were pressed");
  await sender.resize(120, 40);
  await sender.resize(120, 40);
  await sender.resize(5, 1);
  const sizes = s.calls.filter((c) => c.cap === "terminal.resize").map((c) => c.input);
  assert.deepEqual(sizes, [{ terminalId: row.terminalId, cols: 120, rows: 40 }, { terminalId: row.terminalId, cols: 20, rows: 5 }], "the same size is not sent twice, and a size is clamped to what the module takes");
  await sender.input("\x03");
  assert.deepEqual(s.typed, ["l", "s", "\r"], "Ctrl-C goes as terminal.interrupt, not as a second byte");
  await sender.interrupt();
  assert.equal(caps(s).filter((c) => c === "terminal.interrupt").length, 1);

  const frames: TerminalFrame[] = [];
  const stop = att.source.subscribe((f) => void frames.push(f));
  s.print(row.terminalId, "ls\r\nsite  notes.md\r\n");
  await settle(40);
  stop();
  assert.equal(frames.length, 1, "what the shell printed after attach comes as one frame");
  assert.equal(frames[0]?.seq, 1);
  const feed = new TerminalFeed(att.replay);
  assert.equal(feed.push(frames[0] as TerminalFrame), "ok");
  assert.ok(feed.engine.text().includes("site  notes.md"), "the frame lands after the replay");
  assert.deepEqual(failed, []);

  assert.deepEqual(contractErrors(s, (c) => c.startsWith("terminal.")), [], "every terminal call is inside the frozen contract");
  assert.deepEqual(caps(s).slice(0, 3), ["terminal.open", "terminal.attach", "terminal.read"]);
});

test("terminal: a host is chosen in the shared host menu, and each host maps to the call that opens it", () => {
  const picked: string[] = [];
  const entries = hostMenu("agent", false, (h) => void picked.push(h));
  assert.deepEqual(entries.map((e) => ("label" in e ? `${e.label}${e.checked ? " *" : ""}` : "")), ["Agent computer *", "Space server", "This computer"]);
  for (const e of entries) if ("onSelect" in e) e.onSelect?.();
  assert.deepEqual(picked, ["agent", "server", "device"]);
  assert.deepEqual(openCall("server", {}, "k"), { cap: "terminal.open_server", input: { idempotencyKey: "k" } });
  assert.deepEqual(openCall("device", {}, "k"), { cap: "terminal.open", input: { host: "device", idempotencyKey: "k" } });
  assert.deepEqual(openCall("agent", { agentId: "agt_intake", computerId: COMPUTER }, "k"), { cap: "terminal.open", input: { host: "agent_computer", agentId: "agt_intake", computerId: COMPUTER, idempotencyKey: "k" } });
  for (const h of ["agent", "server", "device"] as const) {
    const c = openCall(h, { agentId: "agt_intake" }, "k");
    assert.deepEqual(validateInput(c.cap, 1, c.input), [], h);
  }
});

test("terminal: the Space server is locked without server.services and asks for access; the other hosts stay open", async () => {
  const s = createMountSample();
  s.refuseServer(true);
  const deps = { call: s.rt.call, newKey };
  await assert.rejects(() => openSession(deps, "server", {}), (e: unknown) => isRefusal(e) && errorCode(e) === "permission.role_lacks_permission");
  await assert.rejects(() => attach(deps, SERVER_TERMINAL), (e: unknown) => isRefusal(e));
  assert.equal(isRefusal(new Error("boom")), false, "only a refusal locks the shell");
  assert.equal(await askServerAccess(deps, "northwind"), true);
  const ask = s.calls.find((c) => c.cap === "access.request");
  assert.ok(ask && validateInput("access.request", 1, ask.input).length === 0, "the request is inside the contract");
  const locked = clean(renderToStaticMarkup(<Terminal sessionId={SERVER_TERMINAL} title="" host="server" hostLabel="Space server" locked owner="Maya Chen" fallbackLabel="Intake's computer" />));
  assert.ok(has(locked, 'data-testid="terminal-locked"') && has(locked, "Ask Maya Chen for access") && has(locked, "Open Intake's computer instead"));
  const device = await openSession(deps, "device", {});
  assert.equal(device.host, "device");
  s.refuseServer(false);
  assert.equal((await openSession(deps, "server", {})).host, "space_server");
});

test("terminal: the tab is a side column beside the chat, and a link from Home reattaches a starred session", async () => {
  const s = createMountSample();
  const { go, acts } = doors(s);
  go.terminal(TERMINAL);
  const shown = acts.reduce(step, START);
  assert.equal(shown.terminalId, TERMINAL);
  const out = html(s, shown);
  assert.ok(has(out, 'data-testid="chats-terminal"'), "the terminal column");
  assert.ok(has(out, 'data-testid="conversation"') || has(out, 'data-testid="conversation-loading"'), "the chat stays beside it");
  const linked = fromHash(`screen=chats.terminal-tab&terminalId=${TERMINAL}`);
  assert.equal(linked.terminalId, TERMINAL);
  assert.ok(has(html(s, undefined, `screen=chats.terminal-tab&terminalId=${TERMINAL}`), 'data-testid="chats-terminal"'), "the link is the first thing shown");
  // the pane button closes the terminal first, then opens and closes the pane
  const closed = step(shown, { t: "pane" });
  assert.equal(closed.terminalId, null);
  assert.equal(closed.pane, false);
  assert.equal(step(closed, { t: "pane" }).pane, true);
  // opening a terminal on an agent's computer finds the one already open
  const door = doors(s);
  door.go.terminalOfComputer(COMPUTER);
  await settle(20);
  assert.deepEqual(door.acts, [{ t: "terminal", terminalId: TERMINAL }]);
  assert.equal(caps(s).includes("terminal.open"), false, "no second session");
});

test("terminal list: sessions with where they run, running ones first, the star on a starred one, New terminal under its button", async () => {
  const s = createMountSample();
  const { go } = doors(s);
  const td = terminalData(s.rt, go, { agent: { agentId: "agt_intake", name: "Intake", computerId: COMPUTER }, newKey });
  const out = clean(renderToStaticMarkup(<TerminalList data={td} x={8} y={48} onClose={() => undefined} window={WINDOW} />));
  assert.ok(has(out, 'data-testid="terminal-list"') && has(out, "Terminals") && has(out, "3 in Northwind"));
  const at = (needle: string): number => { const i = out.indexOf(needle); assert.ok(i >= 0, needle); return i; };
  assert.ok(at("Rivera dev server") < at("Space server") && at("Space server") < at("Invoice export"), "running, idle, then exited");
  assert.ok(has(out, 'data-testid="star-trm_rivera"'), "the starred session shows its star");
  assert.ok(!has(out, 'data-testid="star-trm_server"'), "an unstarred one shows it on hover");
  assert.ok(has(out, 'data-testid="terminal-new"') && has(out, 'data-testid="terminal-rules-open"'));
  const rows = [
    { terminalId: "x", state: "exited", lastActiveAt: 9 }, { terminalId: "y", state: "idle", lastActiveAt: 1 }, { terminalId: "z", state: "running", lastActiveAt: 5 },
  ] as unknown as TerminalRow[];
  assert.deepEqual(ordered(rows).map((r) => r.terminalId), ["z", "y", "x"]);
  assert.equal(ago(1_000_000, 1_000_000 - 30_000), "just now");
  assert.equal(ago(1_000_000, 1_000_000 - 5 * 60_000), "5 min ago");
  assert.equal(ago(1_000_000_000, 1_000_000_000 - 3 * 3_600_000), "3 h ago");
  assert.equal(uiState("idle"), "running");
  assert.equal(uiState("exited"), "exited");
  // star and unstar through stars.toggle
  const deps = { call: s.rt.call, newKey };
  assert.equal(await toggleStar(deps, "trm_server", true), true);
  assert.ok(has(clean(renderToStaticMarkup(<TerminalList data={td} x={8} y={48} onClose={() => undefined} window={WINDOW} />)), 'data-testid="star-trm_server"'));
  assert.equal(await toggleStar(deps, TERMINAL, false), true);
  const starCalls = s.calls.filter((c) => c.cap === "stars.toggle").map((c) => c.input);
  assert.deepEqual(starCalls, [{ resource: { type: "terminal", id: "trm_server" }, on: true }, { resource: { type: "terminal", id: TERMINAL }, on: false }]);
  assert.deepEqual(contractErrors(s, (c) => c === "stars.toggle"), []);
});

test("terminal rules: the allow, ask and deny lists and the folders, one entry per line, saved through terminal.rules.set", async () => {
  const s = createMountSample();
  const { go } = doors(s);
  const td = terminalData(s.rt, go, { newKey });
  const out = clean(renderToStaticMarkup(<TerminalRules data={td} onClose={() => undefined} />));
  assert.ok(has(out, 'data-testid="terminal-rules"') && has(out, 'role="dialog"'));
  for (const t of ["Always allow", "Ask first", "Never allow", "Folders it may work in"]) assert.ok(has(out, t), t);
  for (const e of ["git status", "git push", "rm -rf", "fld_rivera"]) assert.ok(has(out, e), `${e} is in its list`);
  assert.ok(has(out, 'data-testid="rules-save"') && has(out, 'data-testid="rules-revert"'));
  assert.deepEqual(parseLines("  git status \n\n git status\nls  \n"), ["git status", "ls"]);
  assert.equal(linesText(["a", "b"]), "a\nb");
  const rules: Rules = { allow: ["git push", "ls"], ask: ["git push"], deny: [], folders: ["fld_work"] };
  assert.equal(rulesProblem(rules), null);
  assert.match(rulesProblem({ allow: Array.from({ length: 201 }, (_, i) => `c${i}`), ask: [], deny: [], folders: [] }) ?? "", /Up to 200 rules/);
  assert.match(rulesProblem({ allow: ["x".repeat(201)], ask: [], deny: [], folders: [] }) ?? "", /at most 200 characters/);
  const kept = await saveRules({ call: s.rt.call, newKey }, rules);
  assert.deepEqual(kept.allow, ["ls"], "an entry on two lists stays on the stronger one");
  assert.equal(sameRules(kept, rules), false);
  assert.equal(sameRules(kept, { ...kept }), true);
  assert.deepEqual(RULE_LISTS, ["allow", "ask", "deny", "folders"]);
  const again = clean(renderToStaticMarkup(<TerminalRules data={td} onClose={() => undefined} />));
  assert.ok(has(again, "fld_work") && !has(again, "git diff"), "the sheet shows what was kept");
  assert.deepEqual(contractErrors(s, (c) => c === "terminal.rules.set"), []);
});

test("terminal: the polled source delivers each answer as the next frame and survives a failed read", async () => {
  let n = 0;
  const answers = ["a", "", "b"];
  const src = pollSource(async () => { n += 1; if (n === 2) throw new Error("offline"); const text = answers.shift() ?? ""; return { text, next: n }; }, 0, 2);
  const frames: TerminalFrame[] = [];
  const stop = src.subscribe((f) => void frames.push(f));
  await settle(60);
  stop();
  await settle(10);
  const seen = frames.length;
  await settle(20);
  assert.equal(frames.length, seen, "no frames after the subscription ends");
  assert.deepEqual(frames.map((f) => f.seq), frames.map((_, i) => i + 1), "sequence numbers count up from one");
  assert.ok(frames.length >= 1 && frames[0]?.data === "a");
});

/* ---------- links and the whole place ---------- */

test("a link from another place opens the screen it names, and an unknown link opens the start", () => {
  assert.deepEqual(fromHash("screen=chats.agent-page&agentId=agt_intake&tab=memory").route, { view: "agent", agentId: "agt_intake", tab: "memory" });
  assert.deepEqual(fromHash("screen=chats.agent-page&agentId=agt_intake&tab=nope").route, { view: "agent", agentId: "agt_intake", tab: null });
  assert.deepEqual(fromHash("screen=tasks.needs-you&taskId=n1").route, { view: "needs", taskId: "n1" });
  assert.deepEqual(fromHash("screen=chats.helper-chat&threadId=h1").route, { view: "helper", threadId: "h1" });
  assert.deepEqual(fromHash("screen=chats.conversation&threadId=c2").route, { view: "chat", threadId: "c2" });
  assert.deepEqual(fromHash("screen=chats.computer-popup&computerId=cmp_1").layer, { kind: "computer", computerId: "cmp_1", chat: false });
  assert.deepEqual(fromHash("screen=chats.recording-sheet&recordingId=rec_1").layer, { kind: "recording", recordingId: "rec_1" });
  assert.deepEqual(fromHash("screen=chats.connect-outside-agent&channelId=ch_1").layer, { kind: "connect", channelId: "ch_1" });
  assert.equal(fromHash("screen=chats.all-agents").layer?.kind, "all-agents");
  assert.equal(fromHash("screen=chats.terminal-list").layer?.kind, "terminals");
  assert.deepEqual(fromHash("screen=chats.terminal-rules").layer, { kind: "rules" });
  assert.equal(fromHash("screen=chats.agent-page").route.view, "chat", "a link without its id is the start");
  assert.deepEqual(fromHash("screen=home.checklist"), START);
  assert.deepEqual(fromHash(""), START);
  const s = createMountSample();
  assert.ok(has(html(s, undefined, "screen=chats.agent-page&agentId=agt_intake"), 'data-testid="agent-page"'), "the hash is the first thing shown");
  assert.ok(has(html(s, undefined, "screen=tasks.needs-you"), 'data-testid="needs-you"'));
});

test("every step changes only what it names: a page closes the layer, a layer keeps the page, the local row is never opened", () => {
  const withLayer = step(START, { t: "layer", layer: { kind: "rules" } });
  assert.deepEqual(step(withLayer, { t: "layer-close" }), START);
  assert.equal(step(withLayer, { t: "agent", agentId: "a" }).layer, null);
  assert.equal(step(withLayer, { t: "chat", threadId: "c2" }).layer, null);
  assert.deepEqual(step(START, { t: "chat", threadId: "local_1" }), START, "a row that chat.start has not answered for is not a thread");
  assert.deepEqual(step(step(START, { t: "chat", threadId: "c2" }), { t: "layer", layer: { kind: "rules" } }).route, { view: "chat", threadId: "c2" });
  assert.deepEqual(step(START, { t: "chat", threadId: "" }).route, { view: "chat", threadId: null });
  assert.equal(step(step(START, { t: "terminal", terminalId: "t" }), { t: "terminal-close" }).terminalId, null);
});

test("the whole place with a runtime draws the sidebar and the open chat, and every control the screens add is in the header", () => {
  const s = createMountSample();
  const out = html(s, step(START, { t: "chat", threadId: "c1" }));
  assert.ok(has(out, 'data-testid="chats-place"') && has(out, 'data-testid="chats-sidebar"') && has(out, 'data-testid="conversation"'));
  for (const id of ["helpers-button", "participants-button", "pane-button", "more-button", "computer-button"]) assert.ok(has(out, `data-testid="${id}"`), id);
  assert.ok(!has(out, "-loading"), "no loading frame once the Space is open");
});
