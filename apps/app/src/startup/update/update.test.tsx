// The start of the desktop app with updates: the Updating screen for a newer version with the toggle on, straight in for anything else, a slow or failed check never holding the start,
// a failed install with "Open Vyre anyway"; and What's new once after an update.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../ui/src/testing/dom.ts";
import { INSTALL_FAILED, StartupUpdate, startStage } from "./StartupUpdate.tsx";
import { UpdatingScreen } from "./UpdatingScreen.tsx";
import { WhatsNewOnce, WhatsNewSheet } from "./WhatsNewSheet.tsx";
import { AUTO_KEY, FROM_KEY, SEEN_KEY } from "./model.ts";
import type { Progress, Store, UpdateCheck } from "./model.ts";
import { resetUpdateState, updateState, updateWaiting } from "./store.ts";
import type { DesktopUpdates } from "./store.ts";

const mem = (init: Record<string, string> = {}): Store & { data: Map<string, string> } => {
  const data = new Map(Object.entries(init));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
};
const found = (o: Partial<UpdateCheck> = {}): UpdateCheck => ({ phase: "available", current: "1.0.0-rc.16", channel: "beta", version: "1.0.0-rc.17", notes: null, checkedAt: 1, ...o });

function shell(answer: UpdateCheck | (() => Promise<UpdateCheck>), install: (on: (p: Progress) => void) => Promise<void> = () => new Promise(() => undefined)): DesktopUpdates & { installs: number; stops: number } {
  const u = {
    installs: 0, stops: 0,
    stopNow: () => { u.stops++; return Promise.resolve(); },
    startup: () => (typeof answer === "function" ? answer() : Promise.resolve(answer)),
    check: () => Promise.resolve(typeof answer === "function" ? found() : answer),
    install: (on?: (p: Progress) => void) => { u.installs++; return install(on ?? (() => undefined)); },
  };
  return u;
}

const Lock = (): ReactElement => <div data-testid="lock-screen">Unlock</div>;

test("a newer version with the toggle on shows Updating Vyre with the version and the real progress, and the lock screen waits", async () => {
  const restore = installDom();
  resetUpdateState();
  let report: (p: Progress) => void = () => undefined;
  const store = mem({ [SEEN_KEY]: "1.0.0-rc.16" });
  const u = shell(found(), (on) => { report = on; return new Promise(() => undefined); });
  try {
    const root = await mount(createRoot, <StartupUpdate updates={u} store={store}><Lock /></StartupUpdate>);
    assert.ok(find(root, "updating-screen"), "the Updating screen");
    assert.equal(find(root, "lock-screen"), null, "before the lock screen");
    assert.match(textOf(find(root, "updating-to")), /Updating to 1\.0\.0-rc\.17/);
    assert.equal(u.installs, 1);
    assert.equal(store.data.get(FROM_KEY), "1.0.0-rc.16", "the next open knows it was an update");
    assert.equal(updateWaiting(updateState()), false, "no dot while it installs");
    await act(async () => { report({ phase: "download", downloaded: 64 * 1024 * 1024, total: 128 * 1024 * 1024 }); });
    assert.match(textOf(find(root, "updating-line")), /64\.0 MB of 128 MB, 50%/);
    assert.equal(find(root, "update-bar")?.props["aria-valuenow"], 50);
    await act(async () => { report({ phase: "waiting", downloaded: 0, total: null, turns: 1 }); });
    assert.match(textOf(find(root, "updating-line")), /Waiting for a reply on this computer to finish/);
  } finally { restore(); resetUpdateState(); }
});

test("an equal or older version, nothing found, offline: straight to the lock screen, nothing installs", async () => {
  const restore = installDom();
  try {
    for (const answer of [found({ version: "1.0.0-rc.16" }), found({ version: "1.0.0-rc.15" }), found({ phase: "none", version: null }), found({ phase: "failed", version: null })]) {
      resetUpdateState();
      const u = shell(answer);
      const root = await mount(createRoot, <StartupUpdate updates={u} store={mem()}><Lock /></StartupUpdate>);
      assert.ok(find(root, "lock-screen"), JSON.stringify(answer));
      assert.equal(u.installs, 0);
    }
    resetUpdateState();
    const broken = shell(() => Promise.reject(new Error("offline")));
    assert.ok(find(await mount(createRoot, <StartupUpdate updates={broken} store={mem()}><Lock /></StartupUpdate>), "lock-screen"), "a check that throws never holds the start");
  } finally { restore(); resetUpdateState(); }
});

test("a check that has not answered in time lets the person in, and a late answer only lights the Settings row and the dot", async () => {
  const restore = installDom();
  resetUpdateState();
  let calls = 0;
  let late: (c: UpdateCheck) => void = () => undefined;
  const u = shell(() => { calls++; return calls === 1 ? Promise.resolve(found({ phase: "checking", version: null })) : new Promise<UpdateCheck>((r) => { late = r; }); });
  try {
    const root = await mount(createRoot, <StartupUpdate updates={u} store={mem()}><Lock /></StartupUpdate>);
    assert.ok(find(root, "lock-screen"));
    await act(async () => { late(found()); });
    await flush();
    assert.ok(find(root, "lock-screen"), "no Updating screen over someone already in");
    assert.equal(u.installs, 0);
    assert.equal(updateWaiting(updateState()), true, "the row and the dot");
  } finally { restore(); resetUpdateState(); }
});

test("the toggle off: no update on start, only the row and the dot", async () => {
  const restore = installDom();
  resetUpdateState();
  const u = shell(found());
  try {
    const root = await mount(createRoot, <StartupUpdate updates={u} store={mem({ [AUTO_KEY]: "0" })}><Lock /></StartupUpdate>);
    assert.ok(find(root, "lock-screen"));
    assert.equal(u.installs, 0);
    assert.equal(updateWaiting(updateState()), true);
  } finally { restore(); resetUpdateState(); }
});

test("a failed install says so in one line, offers Open Vyre anyway, forgets the update note, and the next start tries again", async () => {
  const restore = installDom();
  resetUpdateState();
  const store = mem({ [SEEN_KEY]: "1.0.0-rc.16" });
  const u = shell(found(), () => Promise.reject(new Error("The update did not install: the signature is not valid")));
  try {
    const root = await mount(createRoot, <StartupUpdate updates={u} store={store}><Lock /></StartupUpdate>);
    assert.equal(textOf(find(root, "updating-failed")).trim(), INSTALL_FAILED);
    assert.equal(store.data.get(FROM_KEY), undefined);
    assert.equal(updateWaiting(updateState()), true, "it still waits in Settings");
    await press(find(root, "updating-open"));
    assert.ok(find(root, "lock-screen"));
    const again = shell(found());
    const second = await mount(createRoot, <StartupUpdate updates={again} store={store}><Lock /></StartupUpdate>);
    assert.ok(find(second, "updating-screen"));
    assert.equal(again.installs, 1, "retried on the next start");
  } finally { restore(); resetUpdateState(); }
});

test("a browser or a phone has no shell: the start is the app, at once", () => {
  assert.match(renderToStaticMarkup(<StartupUpdate updates={null}><Lock /></StartupUpdate>), /lock-screen/);
  assert.deepEqual(startStage(found(), true), { kind: "updating", to: "1.0.0-rc.17" });
  assert.deepEqual(startStage(found(), false), { kind: "open" });
});

test("the Updating screen: the mark, the heading, the target version, a thin bar and calm words, and no em dash", () => {
  const out = renderToStaticMarkup(<UpdatingScreen version="1.0.0-rc.17" progress={{ phase: "download", downloaded: 1024 * 1024, total: 4 * 1024 * 1024 }} failure="" onOpenAnyway={() => undefined} />);
  for (const t of ["Updating Vyre", "Updating to 1.0.0-rc.17", "1.0 MB of 4.0 MB, 25%", "Your chats and files stay just as they are"]) assert.ok(out.includes(t), t);
  assert.match(out, /data-icon="vyre-mark"/);
  assert.match(out, /role="progressbar"/);
  assert.ok(!out.includes("—"));
  const failed = renderToStaticMarkup(<UpdatingScreen version="1.0.0-rc.17" progress={null} failure={INSTALL_FAILED} onOpenAnyway={() => undefined} />);
  assert.ok(failed.includes("Open Vyre anyway") && failed.includes(INSTALL_FAILED));
  assert.ok(!failed.includes("Your chats and files"), "one line, not two messages");
});

test("What's new shows once after an update, Continue closes it for good, and a fresh install sees nothing", async () => {
  const restore = installDom();
  const notes = { version: "1.0.0-rc.17", lines: ["Vyre updates itself when it opens.", "Settings has About Vyre."] };
  try {
    const store = mem({ [SEEN_KEY]: "1.0.0-rc.16", [FROM_KEY]: "1.0.0-rc.16" });
    const root = await mount(createRoot, <WhatsNewOnce store={store} load={async () => notes} />);
    assert.ok(find(root, "whats-new"));
    assert.match(textOf(find(root, "whats-new-lines")), /Vyre updates itself when it opens\./);
    await press(find(root, "whats-new-continue"));
    assert.equal(find(root, "whats-new"), null);
    assert.equal(store.data.get(SEEN_KEY), "1.0.0-rc.17");
    const again = await mount(createRoot, <WhatsNewOnce store={store} load={async () => notes} />);
    assert.equal(find(again, "whats-new"), null, "once per version");
    const fresh = mem();
    assert.equal(find(await mount(createRoot, <WhatsNewOnce store={fresh} load={async () => notes} />), "whats-new"), null);
  } finally { restore(); }
  const out = renderToStaticMarkup(<WhatsNewSheet notes={notes} onClose={() => undefined} />);
  for (const t of ["What&#x27;s new in Vyre", "Version 1.0.0-rc.17", "Settings has About Vyre.", "Continue"]) assert.ok(out.includes(t), t);
});

test("while a reply runs the screen names its chat, counts down the wait, and offers Stop and update now once", async () => {
  const restore = installDom();
  resetUpdateState();
  let report: (p: Progress) => void = () => undefined;
  const u = shell(found(), (on) => { report = on; return new Promise(() => undefined); });
  try {
    const root = await mount(createRoot, <StartupUpdate updates={u} store={mem({ [SEEN_KEY]: "1.0.0-rc.16" })}><Lock /></StartupUpdate>);
    assert.equal(find(root, "updating-stop-now"), null, "no button before the wait");
    await act(async () => { report({ phase: "waiting", downloaded: 0, total: null, turns: 1, chats: ["Rivera intake"], left: 522 }); });
    assert.match(textOf(find(root, "updating-line")), /Waiting for the reply in \u201cRivera intake\u201d to finish/);
    assert.match(textOf(find(root, "updating-left")), /8:42 left, then Vyre updates on its own/);
    await act(async () => { report({ phase: "waiting", downloaded: 0, total: null, turns: 1, chats: ["Rivera intake"], left: 0 }); });
    assert.match(textOf(find(root, "updating-left")), /0:00 left/, "the cap ran out: it says so and the shell goes on by itself");
    await press(find(root, "updating-stop-now"));
    await press(find(root, "updating-stop-now"));
    assert.equal(u.stops, 1, "pressed once, asked once");
    assert.match(textOf(find(root, "updating-stop-now")), /Stopping/);
    await act(async () => { report({ phase: "stopping", downloaded: 0, total: null, turns: 1 }); });
    assert.match(textOf(find(root, "updating-line")), /Stopped the reply cleanly\. Getting ready to install/);
    assert.equal(find(root, "updating-stop-now"), null, "the button goes once the wait is over");
    assert.equal(find(root, "updating-left"), null);
  } finally { restore(); }
});

test("a wait with no chat name still reads plainly, and a wait that has no countdown shows none", async () => {
  const restore = installDom();
  try {
    const root = await mount(createRoot, <UpdatingScreen version="1.0.0-rc.17" progress={{ phase: "waiting", downloaded: 0, total: null, turns: 2 }} failure="" onOpenAnyway={() => undefined} onStopNow={() => undefined} />);
    assert.match(textOf(find(root, "updating-line")), /Waiting for 2 replies on this computer to finish/);
    assert.equal(find(root, "updating-left"), null);
    assert.ok(find(root, "updating-stop-now"), "Stop and update now is there even before the shell says how long is left");
  } finally { restore(); }
});
