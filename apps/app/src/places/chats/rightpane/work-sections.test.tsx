// The Computer tab as drawn (AGENT-COMPUTER-2026-11-13.md part A): terminals as rows (no Attach, no Asleep chip, no paragraphs), one browser picture that opens the browser full screen, the sign-ins. The pane mounted over the
// sample Space with stubbed workspace and browser data.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { ChatRightPane } from "./ChatRightPane.tsx";
import { RightPaneDataProvider } from "./data.tsx";
import type { ChatRightPaneData } from "./data.tsx";
import { WorkSections, usesWorkModel } from "./WorkSections.tsx";
import {
  browserHead,
  groupSessions,
  olderDesktopMenu,
  orderSessions,
  ownerLabel,
  sessionWords,
  sharedWait,
  startStage,
  terminalsHead,
} from "./work-model.ts";
import type { BrowserData, BrowserView, WorkspaceData, WorkspaceView } from "./work-model.ts";
import { createSample } from "./sample.ts";
import type { PaneDeps } from "./actions.ts";

const ALL = { start: 0, end: 500 };
const clean = (s: string): string =>
  s
    .replaceAll("<!-- -->", "")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
const LINE = "Waiting for room on the Space server. Add a compute server in Console > Computers to run more.";

const ws = (over: Partial<WorkspaceView> = {}): WorkspaceView => ({
  state: "running",
  host: "the Space server",
  canAttach: true,
  sessions: [
    { name: "main", terminalId: "trm_main", state: "running", cwd: "~/portal" },
    { name: "build", terminalId: "trm_build", state: "idle", cwd: "~/portal" },
  ],
  projects: ["Client portal launch"],
  ...over,
});
const br = (over: Partial<BrowserView> = {}): BrowserView => ({
  state: "open",
  host: "the Space server",
  tabs: 3,
  caption: "Reading the intake form",
  canTakeOver: true,
  sites: [{ site: "app.example.com", signedInAs: "intake@example.com", since: Date.UTC(2026, 9, 28) }],
  ...over,
});

function stub(w: WorkspaceView | null, b: BrowserView | null) {
  const log: string[] = [];
  const workspace: WorkspaceData | undefined = w
    ? {
        watch: (_a, on) => {
          on(w);
          return () => undefined;
        },
        wake: async () => {
          log.push("ws.wake");
        },
        attach: async (a) => {
          log.push(`ws.attach ${a}`);
        },
        ensure: async (a) => {
          log.push(`ws.ensure ${a}`);
        },
        open: (t) => {
          log.push(`ws.open ${t}`);
        },
      }
    : undefined;
  const browser: BrowserData | undefined = b
    ? {
        watch: (_a, on) => {
          on(b);
          return () => undefined;
        },
        open: async (a) => {
          log.push(`br.open ${a}`);
        },
        takeOver: async (a) => {
          log.push(`br.take ${a}`);
        },
        giveBack: async (a) => {
          log.push(`br.give ${a}`);
        },
        signOut: async (a, s) => {
          log.push(`br.signout ${a} ${s}`);
        },
        renderLive: (a) => <span data-testid="the-real-view" data-agent={a} />,
      }
    : undefined;
  return { log, workspace, browser };
}
function paneOver(s: ReturnType<typeof createSample>, over: Partial<ChatRightPaneData>, d: PaneDeps): JSX.Element {
  const data: ChatRightPaneData = {
    ...s.data,
    agent: { agentId: s.data.agent.agentId, name: s.data.agent.name },
    ...over,
  };
  return (
    <RightPaneDataProvider value={data}>
      <WorkSections deps={d} window={ALL} />
    </RightPaneDataProvider>
  );
}
const depsOf = (notes: string[]): PaneDeps => ({
  call: async () => ({}),
  note: (t) => {
    notes.push(t);
  },
});

test("mounted: Terminals, then Browser; the agent has no computer to set up, and nothing in the pane says Attach, Asleep or Older", async () => {
  const off = installDom();
  try {
    const s = createSample();
    const k = stub(ws(), br());
    const root = await mount(createRoot, paneOver(s, { workspace: k.workspace, browser: k.browser }, depsOf([])));
    const t = textOf(root);
    assert.ok(t.indexOf("Terminals") >= 0 && t.indexOf("Terminals") < t.indexOf("Browser"), "Terminals first");
    assert.ok(
      t.includes("main") && t.includes("build") && t.includes("~/portal") && t.includes("Client portal launch"),
    );
    assert.ok(t.includes("Signed in on its computer") && t.includes("app.example.com"));
    assert.ok(
      !/Attach|Wakes in about|Give back|Take over|Nothing yet|Steps|Older desktop|Your Chrome is not touched/.test(t),
      t,
    );
    assert.ok(!/Give .* its own computer|Set up its computer/.test(t), "no setup step");
    assert.equal(find(root, "terminal-attach"), null);
    assert.equal(find(root, "browser-take"), null);
    assert.equal(find(root, "browser-give"), null);
    assert.ok(!t.includes(String.fromCharCode(0x2014)), "no em dash");
  } finally {
    off();
  }
});

test("mounted: pressing a terminal row opens that terminal, with no Attach before", async () => {
  const off = installDom();
  try {
    const s = createSample();
    const k = stub(ws(), br());
    const root = await mount(createRoot, paneOver(s, { workspace: k.workspace, browser: k.browser }, depsOf([])));
    await press(find(root, "row-session-build"));
    await press(find(root, "row-session-main"));
    assert.deepEqual(
      k.log.filter((l) => l.startsWith("ws.open")),
      ["ws.open trm_build", "ws.open trm_main"],
    );
    assert.ok(!k.log.some((l) => l.startsWith("ws.attach")), "no Attach was pressed or needed");
  } finally {
    off();
  }
});

test("mounted: the terminal is open without a press: a computer with none open gets its terminal opened in the background, and one row 'main' stands there meanwhile", async () => {
  const off = installDom();
  try {
    const s = createSample();
    for (const state of ["running", "asleep"] as const) {
      const k = stub(ws({ state, sessions: [] }), br());
      const root = await mount(createRoot, paneOver(s, { workspace: k.workspace, browser: k.browser }, depsOf([])));
      await flush();
      assert.deepEqual(k.log, [`ws.ensure ${s.data.agent.agentId}`], `${state}: opened once, by itself`);
      assert.ok(find(root, "row-session-main"), "the row is there at once");
      assert.ok(/Ready|Asleep/.test(textOf(root)));
    }
    // a computer that has terminals open is not asked for another; one that cannot be entered, or that waits, is not woken
    for (const v of [
      ws(),
      ws({ canAttach: false, sessions: [] }),
      ws({ state: "waiting", sessions: [] }),
      ws({ state: "error", sessions: [] }),
    ]) {
      const k = stub(v, br());
      await mount(createRoot, paneOver(s, { workspace: k.workspace, browser: k.browser }, depsOf([])));
      await flush();
      assert.ok(!k.log.some((l) => l.startsWith("ws.ensure")), `${v.state}/${String(v.canAttach)}: no open`);
    }
  } finally {
    off();
  }
});

test("mounted: the helpers' and people's terminals are rows too, grouped by whose they are, the agent's own first", async () => {
  const off = installDom();
  try {
    const s = createSample();
    const k = stub(
      ws({
        sessions: [
          { name: "Dana's tab", terminalId: "t_p", state: "idle", owner: { kind: "person", name: "Dana" } },
          { name: "lint", terminalId: "t_h", state: "running", owner: { kind: "helper", name: "Tess" } },
          { name: "main", terminalId: "t_a", state: "running", owner: { kind: "agent" } },
        ],
      }),
      null,
    );
    const root = await mount(createRoot, paneOver(s, { workspace: k.workspace }, depsOf([])));
    const t = textOf(root);
    const at = (x: string): number => t.indexOf(x);
    assert.ok(at(s.data.agent.name) < at("Tess") && at("Tess") < at("Dana"), "agent, helper, person");
    assert.ok(t.includes("helper") && t.includes("own tab"));
    assert.ok(at("main") < at("lint") && at("lint") < at("Dana's tab"));
    await press(find(root, "row-session-lint"));
    assert.deepEqual(k.log, ["ws.open t_h"]);
  } finally {
    off();
  }
});

test("mounted: the browser picture is one button that opens the browser full screen; the pane has no Take over or Give back", async () => {
  const off = installDom();
  try {
    const s = createSample();
    const k = stub(ws(), br());
    const root = await mount(createRoot, paneOver(s, { workspace: k.workspace, browser: k.browser }, depsOf([])));
    assert.ok(find(root, "the-real-view") ?? find(root, "browser-live"), "the live picture is in the box");
    assert.equal(find(root, "browser-popup"), null, "closed until pressed");
    await press(find(root, "browser-picture"));
    await flush();
    assert.ok(find(root, "browser-popup"), "pressing the picture opens the browser large");
    assert.ok(find(root, "browser-take"), "Take over is there, not in the pane");
    await press(find(root, "browser-take"));
    assert.ok(k.log.includes(`br.take ${s.data.agent.agentId}`));
    await press(find(root, "browser-popup-close"));
    assert.equal(find(root, "browser-popup"), null);
  } finally {
    off();
  }
});

test("mounted: a sleeping browser shows its quiet page and the time it was last seen; pressing the picture wakes it and opens it", async () => {
  const off = installDom();
  try {
    const s = createSample();
    const k = stub(ws(), br({ state: "closed", lastActiveAt: s.data.clock().now - 60_000 }));
    const root = await mount(createRoot, paneOver(s, { workspace: k.workspace, browser: k.browser }, depsOf([])));
    assert.match(textOf(find(root, "browser-caption")), /^Asleep\. Last seen /);
    assert.equal(find(root, "browser-live"), null, "no live picture while asleep");
    await press(find(root, "browser-picture"));
    await flush();
    assert.ok(find(root, "browser-popup"));
    assert.ok(k.log.includes(`br.open ${s.data.agent.agentId}`), "opening it woke it");
    assert.match(textOf(find(root, "browser-popup-bar")), /Starting the browser/);
    await press(find(root, "browser-popup-close"));
    const none = stub(ws(), br({ state: "closed" }));
    const r2 = await mount(createRoot, paneOver(s, { workspace: none.workspace, browser: none.browser }, depsOf([])));
    assert.match(textOf(find(r2, "browser-caption")), /^Asleep\. Opens when .* loads a page\.$/);
  } finally {
    off();
  }
});

test("mounted: in control, the browser sheet says so and offers Give back; closing it hands the browser back", async () => {
  const off = installDom();
  try {
    const s = createSample();
    const k = stub(ws(), br({ state: "takeover", mine: true, takenBy: "You" }));
    const root = await mount(createRoot, paneOver(s, { workspace: k.workspace, browser: k.browser }, depsOf([])));
    assert.equal(find(root, "browser-give"), null, "never in the pane");
    await press(find(root, "browser-picture"));
    await flush();
    assert.match(textOf(find(root, "browser-popup-bar")), /You have the browser/);
    await press(find(root, "browser-give"));
    assert.ok(k.log.includes(`br.give ${s.data.agent.agentId}`));
    await press(find(root, "browser-popup-close"));
    await flush();
    assert.equal(find(root, "browser-popup"), null);
    assert.ok(k.log.filter((l) => l.startsWith("br.give")).length >= 2, "closing while you hold it gives it back");
  } finally {
    off();
  }
});

test("mounted: a half that is not bound says so in one line, and the other half still works", async () => {
  const off = installDom();
  try {
    const s = createSample();
    const k = stub(ws(), null);
    const root = await mount(createRoot, paneOver(s, { workspace: k.workspace }, depsOf([])));
    assert.match(textOf(find(root, "browser-none")), /browser is not available on this server yet/);
    assert.ok(find(root, "row-session-main"));
    const j = stub(null, br());
    const root2 = await mount(createRoot, paneOver(s, { browser: j.browser }, depsOf([])));
    assert.match(textOf(find(root2, "terminal-none")), /terminal is not available on this server yet/);
  } finally {
    off();
  }
});

test("a waiting workspace and browser for the same reason say the line once, at the top", async () => {
  const off = installDom();
  try {
    const s = createSample();
    const k = stub(ws({ state: "waiting", line: LINE }), br({ state: "waiting", line: LINE }));
    const root = await mount(createRoot, paneOver(s, { workspace: k.workspace, browser: k.browser }, depsOf([])));
    assert.match(
      textOf(find(root, "work-wait")),
      /Waiting for room on the Space server\. Add a compute server in Console > Computers to run more\./,
    );
    assert.equal(textOf(root).split("Add a compute server").length - 1, 1, "once");
    assert.equal(find(root, "terminal-note"), null);
  } finally {
    off();
  }
});

test("a computer that could not start says why in its own words and offers Retry; one waiting for room says so", async () => {
  const off = installDom();
  try {
    const s = createSample();
    const k = stub(
      ws({ state: "error", sessions: [], line: "The workspace image is missing: northwind/workspace:2.4." }),
      null,
    );
    const root = await mount(createRoot, paneOver(s, { workspace: k.workspace }, depsOf([])));
    const t = textOf(root);
    assert.ok(
      t.includes("This computer could not start") && t.includes("northwind/workspace:2.4") && t.includes("Not running"),
    );
    await press(find(root, "terminal-retry"));
    assert.ok(k.log.includes("ws.wake"), "Retry starts it again");
    const w = stub(ws({ state: "waiting", sessions: [] }), null);
    const r2 = await mount(createRoot, paneOver(s, { workspace: w.workspace }, depsOf([])));
    assert.ok(textOf(r2).includes("Waiting for room"));
  } finally {
    off();
  }
});

test("mounted: a person who may not enter sees one line and no list, and no sites", async () => {
  const off = installDom();
  try {
    const s = createSample();
    const k = stub(
      ws({ canAttach: false, cannotAttach: "x" }),
      br({ canTakeOver: false, cannotTakeOver: "A team agent's browser is for owners and admins." }),
    );
    const root = await mount(createRoot, paneOver(s, { workspace: k.workspace, browser: k.browser }, depsOf([])));
    const t = textOf(root);
    assert.ok(t.includes("You cannot see") && t.includes("Only people who can use"), t);
    assert.ok(!t.includes("build") && !t.includes("app.example.com") && !t.includes("Signed in"));
    assert.ok(t.includes("owners and admins"));
    assert.equal(find(root, "browser-picture"), null);
  } finally {
    off();
  }
});

test("mounted: an agent that still has an older desktop gets one row that opens it; an agent without one gets none", async () => {
  const off = installDom();
  try {
    const s = createSample();
    const k = stub(ws(), br());
    const withOld = paneOver(
      s,
      {
        workspace: k.workspace,
        browser: k.browser,
        agent: { agentId: s.data.agent.agentId, name: s.data.agent.name, computerId: "cmp_old" },
      },
      depsOf([]),
    );
    const root = await mount(createRoot, withOld);
    const t = textOf(root);
    assert.ok(t.includes("Older desktop") && t.includes("Open its desktop"));
    assert.ok(!/sign-ins move|kept until you remove/.test(t), "one row, no paragraph");
    await press(find(root, "row-older-desktop"));
    assert.deepEqual(s.opened.slice(-1), ["computer:cmp_old"]);
    const none = await mount(createRoot, paneOver(s, { workspace: k.workspace, browser: k.browser }, depsOf([])));
    assert.ok(!textOf(none).includes("Older desktop"));
  } finally {
    off();
  }
});

test("sessions say who owns them, and the agent's own come first", () => {
  assert.equal(ownerLabel(undefined, "Dex"), "Dex");
  assert.equal(ownerLabel({ kind: "helper", name: "Tess" }, "Dex"), "helper: Tess");
  const list = [
    { name: "p", owner: { kind: "person" as const, name: "Maya" } },
    { name: "h", owner: { kind: "helper" as const, name: "Tess" } },
    { name: "a2", owner: { kind: "agent" as const } },
    { name: "a1" },
  ];
  assert.deepEqual(
    orderSessions(list).map((x) => x.name),
    ["a2", "a1", "h", "p"],
  );
  assert.equal(sharedWait({ state: "waiting" }, { state: "waiting" }), LINE);
  assert.equal(sharedWait({ state: "waiting" }, { state: "open" }), null);
});

test("the pane: with the work model bound the Computer tab is there for an agent with no computer, and the old single-computer tab is what a pane with neither draws", () => {
  const s = createSample();
  assert.equal(usesWorkModel({}), false);
  assert.equal(usesWorkModel({ workspace: stub(ws(), null).workspace }), true);
  const bare = { ...s.data, agent: { agentId: s.data.agent.agentId, name: s.data.agent.name } };
  const without = clean(
    renderToStaticMarkup(
      <ChatRightPane data={bare} open onToggle={() => undefined} tab="computer" window={ALL} paneWidth={640} />,
    ),
  );
  assert.ok(
    !without.includes(">Computer<") && !without.includes('data-testid="pane-body-computer"'),
    "no computer and nothing bound: no Computer tab, as before",
  );
  const k = stub(ws(), br());
  const withWork = clean(
    renderToStaticMarkup(
      <ChatRightPane
        data={{ ...bare, workspace: k.workspace, browser: k.browser }}
        open
        onToggle={() => undefined}
        tab="computer"
        window={ALL}
        paneWidth={640}
      />,
    ),
  );
  assert.ok(withWork.includes(">Computer<") && withWork.includes('data-testid="pane-body-computer"'));
  assert.ok(!withWork.includes('data-testid="computer-none"'), "no Give-it-a-computer step");
});

test("an agent that still has a legacy desktop computer keeps the single-computer tab until the browser half is bound", () => {
  const w = stub(ws(), null).workspace;
  const b = stub(null, br()).browser;
  assert.equal(usesWorkModel({ workspace: w, agent: { computerId: "cmt_1" } }), false);
  assert.equal(usesWorkModel({ workspace: w, browser: b, agent: { computerId: "cmt_1" } }), true);
  assert.equal(usesWorkModel({ workspace: w, agent: {} }), true);
  const s = createSample();
  const legacy = clean(
    renderToStaticMarkup(
      <ChatRightPane
        data={{ ...s.data, workspace: w }}
        open
        onToggle={() => undefined}
        tab="computer"
        window={ALL}
        paneWidth={640}
      />,
    ),
  );
  assert.ok(
    !legacy.includes('data-testid="terminal-card"') && legacy.includes('data-testid="pane-body-computer"'),
    "the sample agent has a computer: today's tab",
  );
});

test("the older desktop's Remove entry: an owner or admin gets it and it opens the Console at that computer; a member gets none; where the pane cannot open the Console it is absent", async () => {
  const { allows, GATE } = await import("../../../shell/providers/runtime.tsx");
  const team = (perms: string[]) => ({ permissions: new Set(perms), space: { kind: "team" } });
  const opened: string[] = [];
  const open = (): void => {
    opened.push("cmp_old");
  };
  for (const [who, perms] of [
    ["owner", ["access.manage", "chats.private"]],
    ["admin", ["access.manage"]],
  ] as const) {
    const menu = olderDesktopMenu({ canRemove: allows(team([...perms]), GATE.provisionComputer), open });
    assert.deepEqual(
      menu.map((m) => m.label),
      ["Remove in Console > Computers"],
      who,
    );
    menu[0]!.onSelect();
  }
  assert.deepEqual(opened, ["cmp_old", "cmp_old"], "it opens the Console at that computer");
  assert.deepEqual(
    olderDesktopMenu({ canRemove: allows(team(["chats.private"]), GATE.provisionComputer), open }),
    [],
    "a member is shown nothing to press",
  );
  assert.deepEqual(olderDesktopMenu({ canRemove: true, open: undefined }), [], "no way to open the Console, no entry");
});

test("one word for where work happened: Browser for the agent's Space browser, Your Chrome for the person's own, the app on an agent's computer", async () => {
  const { placeWord, stepWho } = await import("./model.ts");
  assert.equal(placeWord("chrome_open", "browser"), "Browser");
  assert.equal(placeWord("chrome_open", "my-chrome"), "Your Chrome");
  assert.equal(placeWord("chrome_open"), "Chrome");
  assert.equal(placeWord("terminal_run"), "Terminal");
  assert.equal(placeWord(null, "browser"), "Browser");
  assert.equal(stepWho({ by: "agent", tool: "chrome_open" } as never, "browser"), "Browser");
  assert.equal(stepWho({ by: "person", tool: "chrome_open" } as never, "browser"), "You");
});

test("the words of the pane: a dot and one word, never a chip or a sentence", () => {
  assert.deepEqual(terminalsHead(ws()), { word: "Running", dot: "run" });
  assert.deepEqual(terminalsHead(ws({ sessions: [{ name: "m", state: "idle" }] })), { word: "Ready", dot: "idle" });
  assert.deepEqual(terminalsHead(ws({ state: "asleep" })), { word: "Asleep", dot: "zz" });
  assert.deepEqual(terminalsHead(ws({ state: "waiting" })), { word: "Waiting", dot: "wait" });
  assert.deepEqual(terminalsHead(ws({ state: "error" })), { word: "Not running", dot: "dead" });
  assert.deepEqual(sessionWords({ name: "m", state: "running" }, false), { word: "Running", dot: "run" });
  assert.deepEqual(sessionWords({ name: "m", state: "idle" }, false), { word: "Idle", dot: "idle" });
  assert.deepEqual(sessionWords({ name: "m", state: "idle" }, true), { word: "Asleep", dot: "zz" });
  assert.deepEqual(sessionWords({ name: "m", state: "exited" }, true), { word: "Ended", dot: "dead" });
  assert.deepEqual(browserHead(br()), { word: "Live", dot: "run" });
  assert.deepEqual(browserHead(br({ state: "closed" })), { word: "Asleep", dot: "zz" });
  assert.deepEqual(browserHead(br({ state: "error" })), { word: "Stopped", dot: "dead" });
  const g = groupSessions(
    [
      { name: "a", owner: { kind: "person", name: "Sara" } },
      { name: "b", owner: { kind: "helper", name: "Tess" } },
      { name: "c" },
      { name: "d", owner: { kind: "helper", name: "Tess" } },
    ],
    "Mira",
  );
  assert.deepEqual(
    g.map((x) => [x.name, x.tag, x.rows.length]),
    [
      ["Mira", undefined, 1],
      ["Tess", "helper", 2],
      ["Sara", "own tab", 1],
    ],
  );
  assert.deepEqual(
    [startStage(0), startStage(5000), startStage(8000)],
    ["Making the computer", "Opening the browser", "Almost ready"],
  );
});

test("a terminal held by a person says so in the row's word, for you and for others", () => {
  const nameOf = (id: string): string => (id === "usr_sara" ? "Sara" : "Someone");
  const held = { name: "main", state: "running" as const, heldBy: "usr_sara" };
  assert.deepEqual(sessionWords(held, false, { me: "usr_dana", nameOf }), {
    word: "Sara has the keyboard",
    dot: "wait",
  });
  assert.deepEqual(sessionWords({ ...held, heldBy: "usr_dana" }, false, { me: "usr_dana", nameOf }), {
    word: "You have the keyboard",
    dot: "wait",
  });
  assert.deepEqual(
    sessionWords(held, true, { me: "usr_dana", nameOf }),
    { word: "Asleep", dot: "zz" },
    "a sleeping computer is asleep",
  );
  assert.deepEqual(sessionWords({ ...held, state: "exited" }, false, { me: "usr_dana", nameOf }), {
    word: "Ended",
    dot: "dead",
  });
});
