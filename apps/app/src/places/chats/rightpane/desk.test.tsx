// The desk (Desk.tsx, desk-store.ts): the full view and the small picture are one surface whose edges move; Take over, Give back and Restart do what the sheet's did; the keys act only while you watch; Esc,
// a press outside and the shrink button go back to where it was opened from; closing while you hold the browser gives it back; nothing is drawn over the app when closed.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { DeskHost, MINI, edgesOf } from "./Desk.tsx";
import { deskDispatch, deskOpen, deskReset, deskSnapshot } from "./desk-store.ts";
import type { BrowserData, BrowserView } from "./work-model.ts";

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
