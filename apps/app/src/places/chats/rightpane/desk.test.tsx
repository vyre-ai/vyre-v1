// The desk (Desk.tsx, desk-store.ts): the full view and the small picture are one surface whose edges move; Take over, Give back and Restart do what the sheet's did; the keys act only while you watch; Esc,
// a press outside and the shrink button go back to where it was opened from; closing while you hold the browser gives it back; nothing is drawn over the app when closed.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { AgentCursor, DeskHost, MINI, Scrubbed, StepRing, activeKindOf, edgesOf } from "./Desk.tsx";
import { deskDispatch, deskOpen, deskReset, deskSnapshot } from "./desk-store.ts";
import type { BrowserData, BrowserView } from "./work-model.ts";
import { createSample } from "./sample.ts";

/** Every root a test mounts is unmounted before the fake document goes, so no desk from one test still hears the next test's store. */
const roots: Array<{ unmount(): void }> = [];
const cr = (): ReturnType<typeof createRoot> => {
  const r = createRoot();
  roots.push(r);
  return r;
};
const unmountAll = (): void => {
  for (const r of roots.splice(0)) r.unmount();
};

function rig(first: BrowserView) {
  const calls: string[] = [];
  const notes: string[] = [];
  const asked: string[] = [];
  let on: (v: BrowserView) => void = () => undefined;
  const data: BrowserData = {
    watch(_id, f) {
      on = f;
      f(first);
      return () => undefined;
    },
    async open(id) {
      calls.push(`open ${id}`);
    },
    async takeOver(id) {
      calls.push(`take ${id}`);
    },
    async giveBack(id) {
      calls.push(`give ${id}`);
    },
    async pause(id) {
      calls.push(`pause ${id}`);
    },
    async resume(id, o) {
      calls.push(`resume ${id}${o?.stopped ? " stopped" : ""}`);
    },
    async signOut() {},
    renderLive: () => <span>live</span>,
  };
  return {
    asked,
    calls,
    notes,
    data,
    push: (v: BrowserView) => on(v),
    session: {
      agentId: "agt_dex",
      name: "Dex",
      data,
      threadId: "thr_1",
      call: async (cap: string, input: unknown) => {
        asked.push(`${cap} ${JSON.stringify(input)}`);
        return { state: "asleep" };
      },
      note: (t: string) => notes.push(t),
    },
  };
}
const open: BrowserView = { state: "open", canTakeOver: true, sites: [], caption: "Typing" };
const hold = (mineHolds: boolean): BrowserView => ({
  state: "takeover",
  canTakeOver: true,
  sites: [],
  mine: mineHolds,
  takenBy: "Dana",
});

test("the edges: full is a 2.5% margin all round, mini a small card at the bottom right, and a phone-width full has no rounded corners", () => {
  assert.deepEqual(edgesOf("full", { width: 1440, height: 900 }), {
    top: 23,
    left: 36,
    right: 36,
    bottom: 23,
    radius: 18,
  });
  const m = edgesOf("mini", { width: 1440, height: 900 });
  assert.deepEqual(m, {
    top: 900 - MINI.bottom - MINI.height,
    left: 1440 - MINI.right - MINI.width,
    right: MINI.right,
    bottom: MINI.bottom,
    radius: 16,
  });
  assert.equal(edgesOf("full", { width: 390, height: 800 }).radius, 0);
});

test("closed draws nothing; the full view draws the surface, the scrim and the bar with Take over; the small picture is the same surface with the app undimmed", async () => {
  const off = installDom();
  deskReset();
  try {
    const r = rig(open);
    const root = await mount(cr, <DeskHost />);
    assert.equal(find(root, "desk"), null);
    assert.equal(find(root, "desk-mini"), null);
    deskOpen(r.session);
    await flush();
    assert.ok(find(await mount(cr, <DeskHost />), "desk"), "full view");
    deskDispatch({ type: "minimise" });
    await flush();
    const mini = await mount(cr, <DeskHost />);
    assert.ok(find(mini, "desk-mini"), "the small picture");
    assert.equal(find(mini, "desk"), null);
    deskDispatch({ type: "close" });
    assert.equal(deskSnapshot().session, null, "closed keeps no session");
  } finally {
    unmountAll();
    deskReset();
    off();
  }
});

test("Take over, Give back and Restart call the browser data; a failure says so in plain words and the bar stays", async () => {
  const off = installDom();
  deskReset();
  try {
    const r = rig(open);
    deskOpen(r.session);
    const root = await mount(cr, <DeskHost />);
    await press(find(root, "browser-take"));
    await flush();
    assert.deepEqual(
      r.calls.filter((c) => c.startsWith("take")),
      ["take agt_dex"],
    );
    r.push(hold(true));
    await flush();
    assert.ok(find(root, "browser-give"));
    await press(find(root, "browser-give"));
    await flush();
    assert.deepEqual(
      r.calls.filter((c) => c.startsWith("give")),
      ["give agt_dex"],
    );
    r.push({ state: "error", line: "gone", canTakeOver: true, sites: [] });
    await flush();
    await press(find(root, "browser-restart"));
    await flush();
    assert.ok(r.calls.includes("open agt_dex"));
    // a refused take-over is said, and the desk goes on
    r.data.takeOver = async () => {
      throw new Error("Someone else has the controls.");
    };
    r.push(open);
    await flush();
    await press(find(root, "browser-take"));
    await flush();
    assert.deepEqual(r.notes, ["Someone else has the controls."]);
    assert.ok(find(root, "desk"));
  } finally {
    unmountAll();
    deskReset();
    off();
  }
});

test("someone else has the browser: the bar says who and offers nothing to press; a watcher who may not take over is told, with no Take over", async () => {
  const off = installDom();
  deskReset();
  try {
    const r = rig(hold(false));
    deskOpen(r.session);
    const root = await mount(cr, <DeskHost />);
    assert.match(textOf(find(root, "desk-bar")), /Dana has the browser/);
    assert.equal(find(root, "browser-take"), null);
    assert.equal(find(root, "browser-give"), null);
    r.push({ state: "open", canTakeOver: false, cannotTakeOver: "Only its owner can take over.", sites: [] });
    await flush();
    assert.equal(find(root, "browser-take"), null);
    assert.match(textOf(find(root, "desk-bar")), /Only its owner can take over/);
  } finally {
    unmountAll();
    deskReset();
    off();
  }
});

test("back, minimise, a press outside and close do what the model says; full from the small picture goes back to the small picture", async () => {
  const off = installDom();
  deskReset();
  try {
    const r = rig(open);
    deskOpen(r.session);
    const root = await mount(cr, <DeskHost />);
    await press(find(root, "desk-minimise"));
    await flush();
    assert.equal(deskSnapshot().state.mode, "mini");
    await press(find(root, "desk-mini-open"));
    await flush();
    assert.deepEqual([deskSnapshot().state.mode, deskSnapshot().state.prev], ["full", "mini"]);
    await press(find(root, "desk-scrim"));
    await flush();
    assert.equal(deskSnapshot().state.mode, "mini", "a press outside goes back to where it was opened from");
    deskDispatch({ type: "full" });
    await flush();
    await press(find(root, "desk-back"));
    await flush();
    assert.equal(deskSnapshot().state.mode, "mini");
    deskDispatch({ type: "full" });
    await flush();
    await press(find(root, "desk-close"));
    await flush();
    assert.equal(deskSnapshot().state.mode, "closed");
    assert.deepEqual(r.calls, [], "closing while you only watch hands nothing back");
  } finally {
    unmountAll();
    deskReset();
    off();
  }
});

test("closing while you hold the browser hands it back, so a closed desk never leaves the agent waiting", async () => {
  const off = installDom();
  deskReset();
  try {
    const r = rig(hold(true));
    deskOpen(r.session);
    const root = await mount(cr, <DeskHost />);
    await press(find(root, "desk-close"));
    await flush();
    assert.deepEqual(r.calls, ["give agt_dex"]);
    assert.equal(deskSnapshot().state.mode, "closed");
  } finally {
    unmountAll();
    deskReset();
    off();
  }
});

test("a sleeping browser wakes once when the desk opens, and a failed start is said", async () => {
  const off = installDom();
  deskReset();
  try {
    const r = rig({ state: "closed", canTakeOver: true, sites: [] });
    r.data.open = async () => {
      r.calls.push("open");
      throw new Error("No room for a browser.");
    };
    deskOpen(r.session);
    await mount(cr, <DeskHost />);
    await flush();
    assert.deepEqual(r.calls, ["open"], "once, not on every redraw");
    assert.deepEqual(r.notes, ["No room for a browser."]);
  } finally {
    unmountAll();
    deskReset();
    off();
  }
});

test("another agent's desk replaces this one, never stacks beside it", () => {
  deskReset();
  const a = rig(open);
  deskOpen(a.session);
  deskDispatch({ type: "minimise" });
  const b = rig(open);
  deskOpen({ ...b.session, agentId: "agt_two", name: "Two" });
  assert.deepEqual(
    [deskSnapshot().session?.agentId, deskSnapshot().state.mode, deskSnapshot().state.prev],
    ["agt_two", "full", "dock"],
  );
  deskReset();
});

const paused: BrowserView = { state: "open", canTakeOver: true, sites: [], paused: true, pausedBy: "You" };
const keysOf = (): Array<(e: unknown) => void> => {
  const handlers: Array<(e: unknown) => void> = [];
  const doc = (globalThis as unknown as { document: Record<string, unknown> }).document;
  doc["addEventListener"] = (t: string, f: (e: unknown) => void): void => {
    if (t === "keydown") handlers.push(f);
  };
  doc["removeEventListener"] = (t: string, f: (e: unknown) => void): void => {
    const i = handlers.indexOf(f);
    if (t === "keydown" && i >= 0) handlers.splice(i, 1);
  };
  return handlers;
};
const key = (k: string, over: Record<string, unknown> = {}) => ({
  key: k,
  target: {},
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: k.length === 1 && k !== k.toLowerCase() && k !== " ",
  repeat: false,
  isComposing: false,
  defaultPrevented: false,
  preventDefault() {},
  ...over,
});

test("Pause holds the agent's next step, the bar then says Paused with Resume, and Take over is still there; Resume lets it go", async () => {
  const off = installDom();
  deskReset();
  try {
    const r = rig(open);
    deskOpen(r.session);
    const root = await mount(cr, <DeskHost />);
    await press(find(root, "browser-pause"));
    await flush();
    assert.deepEqual(
      r.calls.filter((c) => c.startsWith("pause")),
      ["pause agt_dex"],
    );
    r.push(paused);
    await flush();
    assert.match(textOf(find(root, "desk-bar")), /Paused/);
    assert.equal(find(root, "browser-pause"), null, "no second Pause while paused");
    assert.ok(find(root, "browser-take"), "taking over while paused is one press");
    await press(find(root, "browser-resume"));
    await flush();
    assert.deepEqual(
      r.calls.filter((c) => c.startsWith("resume")),
      ["resume agt_dex"],
    );
    // take over while paused calls the take-over, which ends the pause on the server
    r.push(paused);
    await flush();
    await press(find(root, "browser-take"));
    await flush();
    assert.ok(r.calls.includes("take agt_dex"));
  } finally {
    unmountAll();
    deskReset();
    off();
  }
});

test("Stop is the thread's own turn stop for this agent; stopping while paused also tells the waiting step it was stopped; with no thread there is no Stop", async () => {
  const off = installDom();
  deskReset();
  try {
    const r = rig(paused);
    deskOpen(r.session);
    const root = await mount(cr, <DeskHost />);
    await press(find(root, "browser-stop"));
    await flush();
    assert.deepEqual(r.asked, ['engine.stop {"threadId":"thr_1","agentId":"agt_dex"}']);
    assert.deepEqual(
      r.calls.filter((c) => c.startsWith("resume")),
      ["resume agt_dex stopped"],
    );
    unmountAll();
    deskReset();
    const q = rig(open);
    deskOpen({ ...q.session, threadId: undefined as never });
    const bare = await mount(cr, <DeskHost />);
    assert.equal(find(bare, "browser-stop"), null);
  } finally {
    unmountAll();
    deskReset();
    off();
  }
});

test("a failed pause or stop is said in plain words and the desk stays", async () => {
  const off = installDom();
  deskReset();
  try {
    const r = rig(open);
    r.data.pause = async () => {
      throw new Error("Someone else paused it.");
    };
    deskOpen({ ...r.session, call: async () => Promise.reject(new Error("Stop did not reach the agent.")) });
    const root = await mount(cr, <DeskHost />);
    await press(find(root, "browser-pause"));
    await flush();
    await press(find(root, "browser-stop"));
    await flush();
    assert.deepEqual(r.notes, ["Someone else paused it.", "Stop did not reach the agent."]);
    assert.ok(find(root, "desk"));
  } finally {
    unmountAll();
    deskReset();
    off();
  }
});

test("keys: F toggles the full view, Space pauses then resumes, S stops, T takes over; none of them while you hold the controls or type in a field, and none with a modifier", async () => {
  const off = installDom();
  deskReset();
  try {
    const keys = keysOf();
    const r = rig(open);
    deskOpen(r.session);
    await mount(cr, <DeskHost />);
    const fire = (k: string, over?: Record<string, unknown>): void => keys.forEach((f) => f(key(k, over)));
    fire(" ");
    await flush();
    assert.deepEqual(
      r.calls.filter((c) => /^(pause|resume)/.test(c)),
      ["pause agt_dex"],
    );
    r.push(paused);
    await flush();
    fire(" ");
    await flush();
    assert.deepEqual(
      r.calls.filter((c) => /^(pause|resume)/.test(c)),
      ["pause agt_dex", "resume agt_dex"],
    );
    fire("S");
    await flush();
    assert.equal(r.asked.length, 1);
    fire("t");
    await flush();
    assert.ok(r.calls.includes("take agt_dex"));
    fire("f");
    await flush();
    assert.equal(deskSnapshot().state.mode, "dock", "F steps back from full to where it was opened from (the pane)");
    assert.equal(deskSnapshot().session, null, "and the pane's own picture is what is left");
    // opened again (a press on the pane's picture): a new desk listens, the old one is gone
    deskOpen(r.session);
    await flush();
    assert.equal(deskSnapshot().state.mode, "full");
    // typing in a field, a modifier, and holding the controls leave the key alone
    const before = r.calls.length + r.asked.length;
    fire("s", { target: { tagName: "INPUT" } });
    fire("s", { metaKey: true });
    r.push(hold(true));
    await flush();
    fire("s");
    fire(" ");
    fire("t");
    await flush();
    assert.equal(r.calls.length + r.asked.length, before, JSON.stringify([r.calls, r.asked]));
  } finally {
    unmountAll();
    deskReset();
    off();
  }
});

test("the cursor and the steps are asked for only while the full view shows a live page: not in the small picture, not before the page is open, not while you hold the controls", async () => {
  const off = installDom();
  deskReset();
  try {
    const r = rig(open);
    let pointerAsks = 0;
    let stepAsks = 0;
    r.data.pointer = async () => {
      pointerAsks += 1;
      return null;
    };
    r.data.steps = async () => {
      stepAsks += 1;
      return [];
    };
    deskOpen(r.session);
    await mount(cr, <DeskHost />);
    await flush();
    assert.ok(pointerAsks >= 1 && stepAsks >= 1, "asked while full and live");
    deskDispatch({ type: "minimise" });
    await flush();
    const p0 = pointerAsks;
    await flush();
    await flush();
    assert.equal(pointerAsks, p0, "not asked from the small picture");
    deskDispatch({ type: "full" });
    await flush();
    r.push(hold(true));
    await flush();
    const p1 = pointerAsks;
    await flush();
    await flush();
    assert.equal(pointerAsks, p1, "not asked while you hold the controls: your cursor is the page's own");
    r.push({ state: "closed", canTakeOver: true, sites: [] });
    await flush();
    const p2 = pointerAsks;
    await flush();
    assert.equal(pointerAsks, p2, "not asked of a browser that sleeps");
  } finally {
    unmountAll();
    deskReset();
    off();
  }
});

test("the cursor draws with the agent's name, and a ring only when it chose an element; it takes no press", async () => {
  const off = installDom();
  try {
    const bare = await mount(cr, <AgentCursor name="Dex" drawn={{ x: 10, y: 20 }} />);
    assert.ok(find(bare, "agent-cursor"));
    assert.match(textOf(find(bare, "agent-cursor")), /Dex/);
    assert.equal(find(bare, "agent-ring"), null);
    const ringed = await mount(
      cr,
      <AgentCursor name="Dex" drawn={{ x: 10, y: 20, ring: { left: 5, top: 6, width: 100, height: 30 } }} />,
    );
    assert.ok(find(ringed, "agent-ring"));
  } finally {
    unmountAll();
    off();
  }
});

test("the step ring counts what the agent did; a press opens the list of the last eight, newest last, and a second press closes it", async () => {
  const off = installDom();
  try {
    const steps = Array.from({ length: 10 }, (_, i) => ({
      idx: i,
      at: i,
      caption: `Step ${i + 1}`,
      tool: "chrome_click",
      by: "agent" as const,
    }));
    const root = await mount(cr, <StepRing steps={steps} />);
    assert.match(textOf(find(root, "step-ring-button")), /10/);
    assert.equal(find(root, "step-list"), null);
    await press(find(root, "step-ring-button"));
    await flush();
    const list = textOf(find(root, "step-list"));
    assert.ok(list.includes("Step 10") && list.includes("Step 3") && !list.includes("Step 2Step 3"), list);
    assert.ok(!/Step 1(?!0)/.test(list.replace("Step 10", "")), "only the last eight");
    await press(find(root, "step-ring-button"));
    await flush();
    assert.equal(find(root, "step-list"), null);
  } finally {
    unmountAll();
    off();
  }
});

test("pressing a done step shows the screen kept after it, over the live page, with a way back; a step with no picture is not pressable; taking over ends the look back", async () => {
  const off = installDom();
  deskReset();
  try {
    const r = rig(open);
    const asked: string[] = [];
    r.data.steps = async () => [
      { idx: 0, at: 1, caption: "Opened the portal", tool: "chrome_open", by: "agent", frameFileId: "fil_a" },
      { idx: 1, at: 2, caption: "Typed the reference", tool: "chrome_type", by: "agent" },
    ];
    r.data.frame = async (id) => {
      asked.push(id);
      return `/spaces/spc_x/blobs/${id}`;
    };
    deskOpen(r.session);
    const root = await mount(cr, <DeskHost />);
    await flush();
    await press(find(root, "step-ring-button"));
    await flush();
    assert.equal(find(root, "scrubbed"), null, "live until a step is pressed");
    await press(find(root, "step-1")).catch(() => undefined);
    await flush();
    assert.equal(find(root, "scrubbed"), null, "a step with no picture kept does nothing when pressed");
    assert.deepEqual(asked, [], "and asks for no picture");
    await press(find(root, "step-0"));
    await flush();
    assert.ok(find(root, "scrubbed"), "the kept screen is up");
    assert.deepEqual(asked, ["fil_a"]);
    assert.equal(find(root, "agent-cursor"), null, "the cursor points at the live page, so it is hidden meanwhile");
    await press(find(root, "scrub-live"));
    await flush();
    assert.equal(find(root, "scrubbed"), null);
    // pressing the same step twice goes back too, and taking over ends the look back
    await press(find(root, "step-0"));
    await flush();
    await press(find(root, "step-0"));
    await flush();
    assert.equal(find(root, "scrubbed"), null);
    await press(find(root, "step-0"));
    await flush();
    r.push(hold(true));
    await flush();
    assert.equal(find(root, "scrubbed"), null, "you steer the live page now");
  } finally {
    unmountAll();
    deskReset();
    off();
  }
});

test("the scrubbed screen says when it is opening and when it was not kept, and always offers the way back", async () => {
  const off = installDom();
  try {
    const step = {
      idx: 3,
      at: 5,
      caption: "Sent the form",
      tool: "chrome_send",
      by: "agent" as const,
      frameFileId: "fil_z",
    };
    let back = 0;
    const opening = await mount(cr, <Scrubbed step={step} url={undefined} onLive={() => (back += 1)} />);
    assert.match(textOf(find(opening, "scrubbed")), /Opening the screen/);
    const none = await mount(cr, <Scrubbed step={step} url={null} onLive={() => (back += 1)} />);
    assert.match(textOf(find(none, "scrubbed")), /was not kept/);
    await press(find(none, "scrub-live"));
    assert.equal(back, 1);
    assert.match(textOf(find(none, "scrubbed")), /Sent the form/);
  } finally {
    unmountAll();
    off();
  }
});

test("the rooms: Browser, Terminal and Files are one desk; the strip shows only the rooms there are, and switching keeps the desk, the shape and the browser's session", async () => {
  const off = installDom();
  deskReset();
  try {
    const r = rig(open);
    // no pane data: the desk is the browser alone, no room switch
    deskOpen(r.session);
    const alone = await mount(cr, <DeskHost />);
    assert.equal(find(alone, "desk-room-term"), null);
    assert.equal(find(alone, "desk-room-files"), null);
    unmountAll();
    deskReset();
    const s = createSample();
    const terminal = {
      call: async () => ({}),
      connection: { get: () => "online", subscribe: () => () => undefined },
      nav: { openTerminal() {}, closeTab() {} },
    } as never;
    deskOpen({ ...r.session, agentId: s.data.agent.agentId, pane: { ...s.data, terminal } });
    const root = await mount(cr, <DeskHost />);
    await flush();
    assert.ok(find(root, "desk-room-browser") && find(root, "desk-room-term") && find(root, "desk-room-files"));
    assert.ok(find(root, "browser-live"), "the browser room is first");
    await press(find(root, "desk-room-term"));
    await flush();
    assert.equal(deskSnapshot().state.room, "term");
    assert.equal(deskSnapshot().state.mode, "full", "switching a room never changes the shape");
    assert.ok(find(root, "terminal-popup"), "the terminal draws inside the desk");
    assert.equal(find(root, "browser-live"), null);
    assert.equal(find(root, "terminal-popup-close"), null, "it has no Close of its own; the desk has it");
    await press(find(root, "desk-room-files"));
    await flush();
    assert.equal(deskSnapshot().state.room, "files");
    assert.ok(find(root, "files-room"));
    assert.equal(find(root, "terminal-popup"), null);
    await press(find(root, "desk-room-browser"));
    await flush();
    assert.ok(find(root, "browser-live"));
    assert.deepEqual(
      r.calls.filter((c) => c.startsWith("open")),
      [],
      "the browser was not woken again",
    );
  } finally {
    unmountAll();
    deskReset();
    off();
  }
});

test("in the terminal or files room the browser's keys do nothing: Space, S and T are the terminal's and the folder's own, and F still toggles the full view", async () => {
  const off = installDom();
  deskReset();
  try {
    const keys = keysOf();
    const r = rig(open);
    const s = createSample();
    deskOpen({
      ...r.session,
      pane: {
        ...s.data,
        terminal: {
          call: async () => ({}),
          connection: { get: () => "online", subscribe: () => () => undefined },
          nav: { openTerminal() {}, closeTab() {} },
        } as never,
      },
    });
    await mount(cr, <DeskHost />);
    deskDispatch({ type: "room", room: "term" });
    await flush();
    const fire = (k: string): void => keys.forEach((f) => f(key(k)));
    fire(" ");
    fire("s");
    fire("t");
    await flush();
    assert.deepEqual([r.calls.filter((c) => /^(pause|resume|take)/.test(c)), r.asked], [[], []]);
    fire("f");
    await flush();
    assert.equal(deskSnapshot().state.mode, "dock");
  } finally {
    unmountAll();
    deskReset();
    off();
  }
});

test("the agent's browser dies while you watch: the bar says it stopped and offers Restart, Pause and Stop go away, the look back and the cursor end; Restart brings the page back", async () => {
  const off = installDom();
  deskReset();
  try {
    const r = rig(open);
    r.data.steps = async () => [
      { idx: 0, at: 1, caption: "Opened", tool: "chrome_open", by: "agent", frameFileId: "fil_a" },
    ];
    r.data.frame = async (id) => `/spaces/spc_x/blobs/${id}`;
    deskOpen(r.session);
    const root = await mount(cr, <DeskHost />);
    await flush();
    await press(find(root, "step-ring-button"));
    await press(find(root, "step-0"));
    await flush();
    assert.ok(find(root, "scrubbed"));
    r.push({ state: "error", line: "The browser stopped.", canTakeOver: true, sites: [] });
    await flush();
    assert.equal(find(root, "scrubbed"), null, "the look back ends with the page");
    assert.equal(find(root, "browser-pause"), null);
    assert.equal(find(root, "browser-stop"), null);
    assert.equal(find(root, "step-ring"), null);
    assert.match(textOf(find(root, "desk-bar")), /The browser stopped/);
    await press(find(root, "browser-restart"));
    await flush();
    assert.ok(r.calls.includes("open agt_dex"));
    r.push(open);
    await flush();
    assert.ok(find(root, "browser-pause"), "a page that is back is the desk's again");
  } finally {
    unmountAll();
    deskReset();
    off();
  }
});

test("a dropped network never breaks the desk: a failed pointer or steps read keeps the last answer and the desk keeps working; a failed pause or resume is said in words", async () => {
  const off = installDom();
  deskReset();
  try {
    const r = rig(open);
    let asks = 0;
    r.data.pointer = async () => {
      asks += 1;
      throw new Error("offline");
    };
    r.data.steps = async () => {
      throw new Error("offline");
    };
    deskOpen(r.session);
    const root = await mount(cr, <DeskHost />);
    await flush();
    await flush();
    assert.ok(asks >= 1);
    assert.ok(find(root, "desk"), "still there");
    assert.equal(find(root, "agent-cursor"), null);
    r.data.pause = async () => {
      throw new Error("The Space did not answer.");
    };
    await press(find(root, "browser-pause"));
    await flush();
    assert.deepEqual(r.notes, ["The Space did not answer."]);
    assert.ok(find(root, "browser-pause"), "the button is back for another try");
  } finally {
    unmountAll();
    deskReset();
    off();
  }
});

test("two people: when someone else paused the browser, Resume that they may not do is refused in the server's words and the desk stays as it was", async () => {
  const off = installDom();
  deskReset();
  try {
    const r = rig({ state: "open", canTakeOver: true, sites: [], paused: true, pausedBy: "Omar" });
    r.data.resume = async () => {
      throw new Error("Someone else paused it.");
    };
    deskOpen(r.session);
    const root = await mount(cr, <DeskHost />);
    await flush();
    assert.match(textOf(find(root, "desk-bar")), /Paused/);
    await press(find(root, "browser-resume"));
    await flush();
    assert.deepEqual(r.notes, ["Someone else paused it."]);
    assert.ok(find(root, "browser-resume"), "still paused, still offered");
    // and someone else taking the browser while you watch replaces the bar at once with who has it
    r.push(hold(false));
    await flush();
    assert.match(textOf(find(root, "desk-bar")), /Dana has the browser/);
    assert.equal(find(root, "browser-resume"), null);
    assert.equal(find(root, "browser-pause"), null);
  } finally {
    unmountAll();
    deskReset();
    off();
  }
});

test("a send waiting for approval: the bar says so with what it is, offers Allow and Not now only to someone who may answer, answers with the Approve task's own decision, and says a refusal", async () => {
  const off = installDom();
  deskReset();
  try {
    const held = (mayAnswer: boolean, count = 1): BrowserView => ({
      state: "open",
      canTakeOver: true,
      sites: [],
      held: { count, what: "Send the report to Northwind", taskId: "tsk_1", mayAnswer },
    });
    const r = rig(held(true, 3));
    deskOpen(r.session);
    const root = await mount(cr, <DeskHost />);
    await flush();
    assert.match(textOf(find(root, "desk-bar")), /Send asks you first/);
    assert.match(textOf(find(root, "desk-bar")), /Send the report to Northwind and 2 more/);
    await press(find(root, "browser-allow"));
    await flush();
    assert.deepEqual(
      r.asked.filter((a) => a.startsWith("tasks.decide")),
      ['tasks.decide {"taskId":"tsk_1","verdict":"approve"}'],
    );
    await press(find(root, "browser-deny"));
    await flush();
    assert.ok(r.asked.includes('tasks.decide {"taskId":"tsk_1","verdict":"reject"}'));
    // someone who may not answer sees what waits and is offered nothing
    r.push({ state: "open", canTakeOver: true, sites: [], held: { count: 2, what: "", taskId: "", mayAnswer: false } });
    await flush();
    assert.match(textOf(find(root, "desk-bar")), /A send is waiting for approval/);
    assert.match(textOf(find(root, "desk-bar")), /2 waiting/);
    assert.ok(!/Northwind|report/.test(textOf(find(root, "desk-bar"))), "nothing of what it says");
    assert.equal(find(root, "browser-allow"), null);
    assert.equal(find(root, "browser-deny"), null);
    // a refusal is said in words and the choice stays
    r.push(held(true));
    r.session.call = async () => {
      throw new Error("This was already decided.");
    };
    await flush();
    await press(find(root, "browser-allow"));
    await flush();
    assert.deepEqual(r.notes, ["This was already decided."]);
    assert.ok(find(root, "browser-allow"));
    // while you hold the browser the send still waits, and Give back stays
    r.push({ ...held(true), state: "takeover", mine: true, takenBy: "You" });
    await flush();
    assert.ok(find(root, "browser-give"));
    assert.ok(find(root, "browser-allow"));
  } finally {
    unmountAll();
    deskReset();
    off();
  }
});

test("Stop is Shift S: a bare s does nothing, so a letter typed by mistake never ends the agent's work", async () => {
  const off = installDom();
  deskReset();
  try {
    const keys = keysOf();
    const r = rig(open);
    deskOpen(r.session);
    await mount(cr, <DeskHost />);
    await flush();
    keys.forEach((f) => f(key("s")));
    await flush();
    assert.deepEqual(r.asked, [], "bare s");
    keys.forEach((f) => f(key("S")));
    await flush();
    assert.equal(r.asked.length, 1, "Shift S");
  } finally {
    unmountAll();
    deskReset();
    off();
  }
});

test("the keys leave a press alone when something else has it: a held-down repeat, composing, already handled, a focused button or link outside the desk, a field, another dialog or menu, a call in flight", async () => {
  const off = installDom();
  deskReset();
  try {
    const keys = keysOf();
    const r = rig(open);
    deskOpen(r.session);
    await mount(cr, <DeskHost />);
    await flush();
    const doc = (globalThis as unknown as { document: Record<string, unknown> }).document;
    const pauses = (): number => r.calls.filter((c) => c.startsWith("pause")).length;
    const space = (over?: Record<string, unknown>): void => keys.forEach((f) => f(key(" ", over)));
    space({ repeat: true });
    space({ isComposing: true });
    space({ defaultPrevented: true });
    doc["activeElement"] = { tagName: "BUTTON", closest: () => null, getAttribute: () => null };
    space();
    doc["activeElement"] = { tagName: "A", closest: () => null, getAttribute: () => null };
    space();
    doc["activeElement"] = { tagName: "DIV", isContentEditable: true, getAttribute: () => null };
    space();
    doc["activeElement"] = { tagName: "DIV", getAttribute: (n: string) => (n === "role" ? "textbox" : null) };
    space();
    doc["activeElement"] = null;
    doc["querySelector"] = () => ({});
    space();
    doc["querySelector"] = () => null;
    await flush();
    assert.equal(pauses(), 0, "none of those is the desk's key");
    // a control of the desk itself, and nowhere in particular, are the desk's
    doc["activeElement"] = { tagName: "BUTTON", closest: () => ({}), getAttribute: () => null };
    space();
    await flush();
    assert.equal(pauses(), 1);
    // a call in flight is not stacked on: a take-over under way ignores Space until it settles
    r.push(open);
    await flush();
    let release: () => void = () => undefined;
    r.data.takeOver = () => new Promise<void>((ok) => (release = ok));
    keys.forEach((f) => f(key("t")));
    await flush();
    space();
    await flush();
    assert.equal(pauses(), 1, "while the take-over is under way");
    release();
    await flush();
  } finally {
    unmountAll();
    deskReset();
    off();
  }
});

test("where the focus is, for the keys: nothing, a field, a control outside the desk or a control of it", () => {
  assert.equal(activeKindOf(null), "none");
  assert.equal(activeKindOf({ tagName: "BODY" }), "none");
  assert.equal(activeKindOf({ tagName: "INPUT" }), "field");
  assert.equal(activeKindOf({ tagName: "TEXTAREA" }), "field");
  assert.equal(activeKindOf({ tagName: "DIV", isContentEditable: true }), "field");
  assert.equal(activeKindOf({ tagName: "DIV", getAttribute: () => "searchbox" }), "field");
  assert.equal(activeKindOf({ tagName: "BUTTON", closest: () => null }), "outside_control");
  assert.equal(activeKindOf({ tagName: "DIV", getAttribute: () => "tab", closest: () => null }), "outside_control");
  assert.equal(activeKindOf({ tagName: "BUTTON", closest: () => ({}) }), "desk_control");
  assert.equal(activeKindOf({ tagName: "DIV", getAttribute: () => null }), "none");
});
