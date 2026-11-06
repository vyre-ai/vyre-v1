// The Computer tab in the workspace model (l-capacity): a Terminal section and a Browser section, nothing to set up. The words and rules (work-model.ts), the two cards, and the pane mounted over the
// sample Space with stubbed workspace and browser data, the way the two lanes that fill them will bind them.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { ChatRightPane } from "./ChatRightPane.tsx";
import { RightPaneDataProvider } from "./data.tsx";
import type { ChatRightPaneData } from "./data.tsx";
import { BrowserCard, TerminalCard, WorkSections, usesWorkModel } from "./WorkSections.tsx";
import { attachedNote, browserAction, browserWords, sessionsLine, terminalAction, workspaceWords } from "./work-model.ts";
import type { BrowserData, BrowserView, WorkspaceData, WorkspaceView } from "./work-model.ts";
import { createSample } from "./sample.ts";
import type { PaneDeps } from "./actions.ts";

const ALL = { start: 0, end: 500 };
const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const LINE = "Waiting for room on the Space server. Add a compute server in Console > Computers to run more.";

const ws = (over: Partial<WorkspaceView> = {}): WorkspaceView => ({
  state: "running", host: "the Space server", canAttach: true,
  sessions: [{ name: "main", windows: 2, attached: 0 }, { name: "build", windows: 1, attached: 1 }], projects: ["Client portal launch"], ...over,
});
const br = (over: Partial<BrowserView> = {}): BrowserView => ({
  state: "open", host: "the Space server", tabs: 3, caption: "Reading the intake form", canTakeOver: true,
  sites: [{ site: "app.example.com", signedInAs: "intake@example.com", since: Date.UTC(2026, 9, 28) }], ...over,
});

test("the Terminal words: running, asleep, starting, waiting for room (the plain line) and the reason when it failed", () => {
  assert.deepEqual(workspaceWords(ws()), { chip: "Running", tone: "ok" });
  assert.deepEqual(workspaceWords(ws({ sessions: [] })), { chip: "Running", tone: "ok", note: "No session open yet. A command starts one." });
  assert.equal(workspaceWords(ws({ state: "asleep" })).note, "Wakes in about a second on the next command.");
  assert.equal(workspaceWords(ws({ state: "starting" })).chip, "Starting");
  assert.deepEqual(workspaceWords(ws({ state: "waiting", line: LINE })), { chip: "Waiting for room", tone: "warn", note: LINE });
  assert.equal(workspaceWords(ws({ state: "waiting" })).note, LINE, "the same words when the host sends none");
  assert.deepEqual(workspaceWords(ws({ state: "error", line: "The image is missing." })), { chip: "Needs attention", tone: "bad", note: "The image is missing." });
});

test("Attach is offered to a person who may, while the workspace can be used; never while it waits or failed", () => {
  assert.equal(terminalAction(ws()), "attach");
  assert.equal(terminalAction(ws({ state: "asleep" })), "attach", "attaching wakes it");
  for (const state of ["starting", "waiting", "error"] as const) assert.equal(terminalAction(ws({ state })), null, state);
  assert.equal(terminalAction(ws({ canAttach: false })), null);
});

test("the Browser words and its one action: Take over for a permitted person, Give back for the one at the controls, nothing for anyone else", () => {
  assert.deepEqual(browserWords(br()), { chip: "Open · 3 tabs", tone: "ok", note: "Reading the intake form" });
  assert.equal(browserWords(br({ tabs: 1, caption: undefined as never })).chip, "Open · 1 tab");
  assert.deepEqual(browserWords(br({ state: "closed" })), { chip: "Closed", tone: "quiet", note: "Opens when it browses." });
  assert.equal(browserWords(br({ state: "waiting" })).note, LINE);
  assert.equal(browserWords(br({ state: "takeover", mine: true })).chip, "You're in control");
  assert.equal(browserWords(br({ state: "takeover", takenBy: "Maya" })).chip, "Maya is in control");
  assert.equal(browserAction(br()), "take");
  assert.equal(browserAction(br({ state: "closed" })), "take", "taking over opens it");
  assert.equal(browserAction(br({ state: "takeover", mine: true })), "give");
  assert.equal(browserAction(br({ state: "takeover", takenBy: "Maya", canTakeOver: false })), null, "someone else has it");
  assert.equal(browserAction(br({ canTakeOver: false })), null);
  for (const state of ["starting", "waiting", "error"] as const) assert.equal(browserAction(br({ state })), null, state);
});

test("small words: sessions and what is attached", () => {
  assert.equal(sessionsLine(1), "1 session");
  assert.equal(sessionsLine(3), "3 sessions");
  assert.equal(attachedNote({ name: "m", windows: 1, attached: 0 }), "1 window");
  assert.equal(attachedNote({ name: "m", windows: 2, attached: 1 }), "2 windows · 1 attached");
});

test("the Terminal card says where it runs and who may attach, and shows the waiting line in place of Attach", () => {
  const card = (v: WorkspaceView): string => clean(renderToStaticMarkup(<TerminalCard view={v} name="Dex" onAttach={() => undefined} />));
  const run = card(ws());
  assert.ok(run.includes('data-testid="terminal-attach"') && run.includes("Dex's shell, git and the usual tools · on the Space server"));
  const wait = card(ws({ state: "waiting", line: LINE }));
  assert.ok(!wait.includes('data-testid="terminal-attach"') && wait.includes(LINE));
  const no = card(ws({ canAttach: false, cannotAttach: "Only Maya can attach to her Assistant's terminal." }));
  assert.ok(!no.includes('data-testid="terminal-attach"') && no.includes("Only Maya can attach to her Assistant"));
  assert.ok(!(run + wait + no).includes(String.fromCharCode(0x2014)), "no em dash");
});

test("the Browser card: a person who may take over sees the frame, one who may not sees the state and why, and a takeover by me offers Give back", () => {
  const card = (v: BrowserView, live?: JSX.Element): string => clean(renderToStaticMarkup(<BrowserCard view={v} name="Dex" live={live} onTake={() => undefined} onGive={() => undefined} onOpen={() => undefined} />));
  const open = card(br());
  assert.ok(open.includes('data-testid="browser-frame"') && open.includes('data-testid="browser-take"') && open.includes("Reading the intake form") && open.includes("Your Chrome is not touched."));
  const closed = card(br({ state: "closed" }));
  assert.ok(closed.includes('data-testid="browser-open"'), "a closed browser can be opened from its picture");
  const nope = card(br({ canTakeOver: false, cannotTakeOver: "A team agent's browser is for owners and admins." }));
  assert.ok(!nope.includes('data-testid="browser-frame"') && !nope.includes('data-testid="browser-take"') && nope.includes("owners and admins"));
  const mine = card(br({ state: "takeover", mine: true }));
  assert.ok(mine.includes('data-testid="browser-give"') && mine.includes("You're in control") && !mine.includes('data-testid="browser-take"'));
  const live = card(br(), <span data-testid="the-real-view" />);
  assert.ok(live.includes('data-testid="browser-live"') && live.includes("the-real-view") && !live.includes('data-testid="browser-frame"'), "the Space browser's own view replaces the picture");
  const wait = card(br({ state: "waiting", line: LINE }));
  assert.ok(wait.includes(LINE) && !wait.includes('data-testid="browser-take"'));
});

function stub(w: WorkspaceView | null, b: BrowserView | null) {
  const log: string[] = [];
  const workspace: WorkspaceData | undefined = w ? { watch: (_a, on) => { on(w); return () => undefined; }, wake: async () => { log.push("ws.wake"); }, attach: async (a) => { log.push(`ws.attach ${a}`); } } : undefined;
  const browser: BrowserData | undefined = b ? {
    watch: (_a, on) => { on(b); return () => undefined; }, open: async (a) => { log.push(`br.open ${a}`); }, takeOver: async (a) => { log.push(`br.take ${a}`); }, giveBack: async (a) => { log.push(`br.give ${a}`); },
    signOut: async (a, s) => { log.push(`br.signout ${a} ${s}`); },
  } : undefined;
  return { log, workspace, browser };
}
function paneOver(s: ReturnType<typeof createSample>, over: Partial<ChatRightPaneData>, d: PaneDeps): JSX.Element {
  const data: ChatRightPaneData = { ...s.data, agent: { agentId: s.data.agent.agentId, name: s.data.agent.name }, ...over };
  return <RightPaneDataProvider value={data}><WorkSections deps={d} window={ALL} /></RightPaneDataProvider>;
}
const depsOf = (notes: string[]): PaneDeps => ({ call: async () => ({}), note: (t) => { notes.push(t); } });

test("mounted: Terminal then Browser, the agent has no computer and nothing asks to set one up", async () => {
  const off = installDom();
  try {
    const s = createSample();
    const k = stub(ws(), br());
    const root = await mount(createRoot, paneOver(s, { workspace: k.workspace, browser: k.browser }, depsOf([])));
    const t = textOf(root);
    assert.ok(t.indexOf("Terminal") >= 0 && t.indexOf("Terminal") < t.indexOf("Browser"), "Terminal first");
    assert.ok(t.includes("2 sessions") && t.includes("main") && t.includes("build") && t.includes("Client portal launch") && t.includes("app.example.com"));
    assert.ok(!/Give .* its own computer|Set up its computer/.test(t), "no setup step");
  } finally { off(); }
});

test("mounted: Attach attaches this agent's terminal, Take over takes its browser, Give back gives it back, Sign out signs out of the site", async () => {
  const off = installDom();
  try {
    const s = createSample();
    const k = stub(ws(), br());
    const agentId = s.data.agent.agentId;
    const root = await mount(createRoot, paneOver(s, { workspace: k.workspace, browser: k.browser }, depsOf([])));
    await press(find(root, "terminal-attach"));
    await press(find(root, "browser-take"));
    assert.deepEqual(k.log, [`ws.attach ${agentId}`, `br.take ${agentId}`]);
    const m = stub(ws(), br({ state: "takeover", mine: true }));
    const root2 = await mount(createRoot, paneOver(s, { workspace: m.workspace, browser: m.browser }, depsOf([])));
    await press(find(root2, "browser-give"));
    assert.deepEqual(m.log, [`br.give ${agentId}`]);
  } finally { off(); }
});

test("mounted: a refused Attach says why in one line and the button comes back", async () => {
  const off = installDom();
  try {
    const s = createSample();
    const k = stub(ws(), br());
    k.workspace!.attach = async () => { throw new Error("The workspace is waiting for room."); };
    const notes: string[] = [];
    const root = await mount(createRoot, paneOver(s, { workspace: k.workspace, browser: k.browser }, depsOf(notes)));
    await press(find(root, "terminal-attach"));
    await flush();
    assert.equal(notes.length, 1);
    assert.match(notes[0]!, /waiting for room/i);
    assert.ok(find(root, "terminal-attach"), "Attach is back");
  } finally { off(); }
});

test("mounted: a half that is not bound says so in one line, and the other half still works", async () => {
  const off = installDom();
  try {
    const s = createSample();
    const k = stub(ws(), null);
    const root = await mount(createRoot, paneOver(s, { workspace: k.workspace }, depsOf([])));
    assert.match(textOf(find(root, "browser-none")), /browser is not available on this server yet/);
    assert.ok(find(root, "terminal-attach"));
    const j = stub(null, br());
    const root2 = await mount(createRoot, paneOver(s, { browser: j.browser }, depsOf([])));
    assert.match(textOf(find(root2, "terminal-none")), /terminal is not available on this server yet/);
  } finally { off(); }
});

test("a waiting workspace and browser show the same plain line, with a way to run more", async () => {
  const off = installDom();
  try {
    const s = createSample();
    const k = stub(ws({ state: "waiting", line: LINE }), br({ state: "waiting", line: LINE }));
    const root = await mount(createRoot, paneOver(s, { workspace: k.workspace, browser: k.browser }, depsOf([])));
    assert.match(textOf(find(root, "terminal-note")), /Waiting for room on the Space server\. Add a compute server in Console > Computers to run more\./);
    assert.match(textOf(find(root, "browser-note")), /Waiting for room on the Space server\./);
    assert.equal(find(root, "terminal-attach"), null);
    assert.equal(find(root, "browser-take"), null);
  } finally { off(); }
});

test("the pane: with the work model bound the Computer tab is there for an agent with no computer, and the old single-computer tab is what a pane with neither draws", () => {
  const s = createSample();
  assert.equal(usesWorkModel({}), false);
  assert.equal(usesWorkModel({ workspace: stub(ws(), null).workspace }), true);
  const bare = { ...s.data, agent: { agentId: s.data.agent.agentId, name: s.data.agent.name } };
  const without = clean(renderToStaticMarkup(<ChatRightPane data={bare} open onToggle={() => undefined} tab="computer" window={ALL} paneWidth={640} />));
  assert.ok(!without.includes(">Computer<") && !without.includes('data-testid="pane-body-computer"'), "no computer and nothing bound: no Computer tab, as before");
  const k = stub(ws(), br());
  const withWork = clean(renderToStaticMarkup(<ChatRightPane data={{ ...bare, workspace: k.workspace, browser: k.browser }} open onToggle={() => undefined} tab="computer" window={ALL} paneWidth={640} />));
  assert.ok(withWork.includes(">Computer<") && withWork.includes('data-testid="pane-body-computer"'));
  assert.ok(!withWork.includes('data-testid="computer-none"'), "no Give-it-a-computer step");
});

test("mounted: a person who may not attach or take over does not see what is open in its terminal or the sites it is signed in to", async () => {
  const off = installDom();
  try {
    const s = createSample();
    const k = stub(ws({ canAttach: false, cannotAttach: "A team agent's terminal is for owners and admins." }), br({ canTakeOver: false, cannotTakeOver: "A team agent's browser is for owners and admins." }));
    const root = await mount(createRoot, paneOver(s, { workspace: k.workspace, browser: k.browser }, depsOf([])));
    const t = textOf(root);
    assert.ok(!t.includes("dev server") && !t.includes("build") && !t.includes("app.example.com") && !t.includes("Signed in on its browser") && !t.includes("sessions"));
    assert.ok(t.includes("owners and admins") && t.includes("Running") && t.includes("Client portal launch"), "the states and the reasons stay");
    assert.equal(find(root, "terminal-attach"), null);
    assert.equal(find(root, "browser-take"), null);
    assert.equal(find(root, "browser-frame"), null);
  } finally { off(); }
});
