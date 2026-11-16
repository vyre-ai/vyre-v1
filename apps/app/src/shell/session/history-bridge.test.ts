// The browser's Back, Forward and the address bar are one thing with the tab's history (NAV-2026-11-14 rule 2). A fake window keeps a real history list and delivers popstate after
// history.go the way a browser does (asynchronously), so the guards and the return to the middle entry are walked end to end.
import test from "node:test";
import assert from "node:assert/strict";
import { createShellHub } from "../spaces/hub.ts";
import { SEED_DEFS } from "../spaces/model.ts";
import { startHistoryBridge } from "./history-bridge.ts";
import type { BridgeWindow } from "./history-bridge.ts";

function fakeWindow(url: string): BridgeWindow & {
  entries: { state: unknown; url: string }[];
  at: number;
  press(type: string): void;
  settle(): Promise<void>;
} {
  const listeners = new Map<string, Set<(e: never) => void>>();
  const win = {
    entries: [{ state: null as unknown, url }],
    at: 0,
    get location() {
      const u = new URL(win.entries[win.at]!.url, "http://x");
      return { pathname: u.pathname, search: u.search, hash: u.hash };
    },
    history: {
      get state() {
        return win.entries[win.at]!.state;
      },
      pushState(state: unknown, _t: string, u: string) {
        win.entries.splice(win.at + 1);
        win.entries.push({ state, url: u });
        win.at += 1;
      },
      replaceState(state: unknown, _t: string, u: string) {
        win.entries[win.at] = { state, url: u };
      },
      go(delta: number) {
        const from = win.entries[win.at]!;
        const to = win.at + delta;
        if (to < 0 || to >= win.entries.length) return;
        queueMicrotask(() => {
          win.at = to;
          fire("popstate", { state: win.entries[win.at]!.state });
          if (new URL(from.url, "http://x").hash !== new URL(win.entries[win.at]!.url, "http://x").hash)
            fire("hashchange", {});
        });
      },
    },
    addEventListener(t: string, f: (e: never) => void) {
      (listeners.get(t) ?? listeners.set(t, new Set()).get(t)!).add(f);
    },
    removeEventListener(t: string, f: (e: never) => void) {
      listeners.get(t)?.delete(f);
    },
    press(type: string) {
      fire(type, {});
    },
    setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
    settle: () => new Promise<void>((r) => setTimeout(r, 5)),
  };
  function fire(t: string, e: object): void {
    for (const f of [...(listeners.get(t) ?? [])]) f(e as never);
  }
  return win as never;
}

const boot = () => {
  const hub = createShellHub({
    spaces: SEED_DEFS,
    openId: SEED_DEFS[0]!.spaceId,
    personId: "imran",
    deviceId: "web",
    storage: null,
    skeletonMs: 0,
  });
  const win = fakeWindow("/chat");
  const stop = startHistoryBridge(hub, win);
  return { hub, win, stop };
};
const AGENT = "screen=chats.agent-page&agentId=agt_1";

test("the browser's Back runs the tab's Back, Forward runs its Forward, and the address follows what is on screen", async () => {
  const { hub, win, stop } = boot();
  hub.go("chats", "subject=thread:thr_1");
  hub.move("chats", AGENT);
  assert.equal(win.location.hash, `#${AGENT}`);
  win.press("pointerdown"); // the first press makes the guards
  await win.settle();
  assert.equal(win.entries.length, 3);
  assert.equal(win.location.hash, `#${AGENT}`, "still on the middle entry");
  win.history.go(-1); // the browser's Back
  await win.settle();
  assert.equal(hub.state().hash, "subject=thread:thr_1");
  assert.equal(win.location.hash, "#subject=thread:thr_1", "the middle entry shows the new place");
  assert.equal(win.history.state && (win.history.state as { vyre: string }).vyre, "here");
  win.history.go(1);
  await win.settle();
  assert.equal(hub.state().hash, AGENT);
  assert.equal(win.location.hash, `#${AGENT}`);
  stop();
});

test("Back with nowhere to go leaves the person where they are", async () => {
  const { hub, win, stop } = boot();
  win.press("pointerdown");
  await win.settle();
  win.history.go(-1);
  await win.settle();
  assert.equal(hub.state().hash, "");
  // nothing of Vyre's own to go back to: the browser is let go (here, nowhere to leave to in the fake), then the middle entry comes back, so the person is never trapped on a guard
  await new Promise((r) => setTimeout(r, 330));
  assert.equal((win.history.state as { vyre: string }).vyre, "here");
  stop();
});

test("an address edited by hand is a link, and the guard does not read its own stale address", async () => {
  const { hub, win, stop } = boot();
  win.press("pointerdown");
  await win.settle();
  hub.move("chats", AGENT);
  win.history.go(-1);
  await win.settle();
  assert.equal(hub.state().hash, "", "Back went to the landing; the stale guard address did not bring the agent back");
  stop();
});

test("once the address names another Space, the leaving Space's hub no longer writes it (a Space switch must not read the old Space's item into the new one)", async () => {
  const hub = createShellHub({
    spaces: SEED_DEFS,
    openId: SEED_DEFS[0]!.spaceId,
    personId: "imran",
    deviceId: "web",
    storage: null,
    skeletonMs: 0,
  });
  const win = fakeWindow("/files?space=http%3A%2F%2Fa&skin=system#subject=file:fil_a");
  const stop = startHistoryBridge(hub, win);
  // the switch: SessionGate writes the new Space's address (its own place, no item) before the old hub is gone
  win.history.replaceState(win.history.state, "", "/chat?space=http%3A%2F%2Fb&skin=graphite");
  hub.go("files", "subject=file:fil_a_again"); // the old hub still emits once (a flash, a count, a tab title)
  assert.equal(win.location.pathname, "/chat", "the new Space's address stands");
  assert.equal(win.location.hash, "", "the old Space's item is not written under the new Space's address");
  stop();
});
