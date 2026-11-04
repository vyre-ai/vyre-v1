// The top bar's notifications slot (owner, 4 Nov): priority order, persisting versus passing, the +N and its popover, the lock action, and Cmd-L.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createNoticeStore, PASSING_MS, PRIORITY, slotView } from "./model.ts";
import { NoticeSlot } from "./NoticeSlot.tsx";
import { isLocked, lockAvailable, registerLockControl, toggleLock } from "./lock-control.ts";
import { matchShortcut, keyboardRows } from "../keyboard/map.ts";
import { shellKey, SHELL_KEYS } from "../spaces/keys.ts";

const clock = () => { let t = 1_000_000; return { now: () => t, advance: (ms: number) => { t += ms; } }; };
const text = (h: string): string => h.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const act = (label: string) => ({ label, run: () => undefined });

test("the most important notice shows first: locked, then offline, update, machine, approval, reply", () => {
  const c = clock();
  const s = createNoticeStore(c.now);
  s.raise({ id: "reply", kind: "reply", text: "Dana replied" });
  s.raise({ id: "approval", kind: "approval", text: "An approval is waiting" });
  s.raise({ id: "update", kind: "update", text: "Update available", action: act("Restart") });
  s.raise({ id: "offline", kind: "offline", text: "Offline, 3 changes waiting" });
  s.raise({ id: "locked", kind: "locked", text: "Sign-ins locked", action: act("Unlock") });
  s.raise({ id: "machine", kind: "machine", text: "Mac mini is offline" });
  assert.deepEqual(s.getSnapshot().live.map((n) => n.id), ["locked", "offline", "update", "machine", "approval", "reply"]);
  assert.ok(PRIORITY.locked < PRIORITY.offline && PRIORITY.offline < PRIORITY.update && PRIORITY.update < PRIORITY.machine);
  const v = slotView(s.getSnapshot());
  assert.equal(v.top?.id, "locked");
  assert.equal(v.more, 5);
  assert.equal(v.hasLocked, true);
});

test("a persisting notice stays until it is resolved and cannot be dismissed; a passing one shows briefly, then fades into recent", () => {
  const c = clock();
  const s = createNoticeStore(c.now);
  s.raise({ id: "locked", kind: "locked", text: "Sign-ins locked", action: act("Unlock") });
  s.pass("Link copied");
  assert.equal(s.getSnapshot().live[0]!.text, "Link copied", "what just passed shows while it lasts");
  c.advance(PASSING_MS - 1); s.tick();
  assert.equal(s.getSnapshot().live.length, 2);
  c.advance(2); s.tick();
  assert.deepEqual(s.getSnapshot().live.map((n) => n.id), ["locked"], "the passing one faded; the lock stays");
  assert.deepEqual(s.getSnapshot().recent.map((n) => n.text), ["Link copied"]);
  c.advance(60 * 60_000); s.tick();
  assert.equal(s.getSnapshot().live[0]!.id, "locked", "an hour later it is still there");
  s.resolve("locked");
  assert.equal(s.getSnapshot().live.length, 0);
  assert.equal(s.getSnapshot().recent[0]!.text, "Sign-ins locked", "resolved, it shows under recent");
  // the slot draws no dismiss for any notice
  const store = createNoticeStore(c.now);
  store.raise({ id: "locked", kind: "locked", text: "Sign-ins locked", action: act("Unlock") });
  assert.ok(!/dismiss|close/i.test(renderToStaticMarkup(<NoticeSlot store={store} />)));
});

test("the slot shows the top notice with its one action and +N; the popover lists them with their actions and the recent ones", () => {
  const s = createNoticeStore();
  s.raise({ id: "locked", kind: "locked", text: "Sign-ins locked", action: act("Unlock") });
  s.raise({ id: "update", kind: "update", text: "Update available", action: act("Restart") });
  s.raise({ id: "offline", kind: "offline", text: "Offline" });
  const wide = renderToStaticMarkup(<NoticeSlot store={s} />).replaceAll("<!-- -->", "");
  assert.match(text(wide), /Sign-ins locked Unlock \+2/);
  assert.match(wide, /data-testid="notice-action"/);
  assert.doesNotMatch(wide, /Update available/, "only the top one is in the line");
  const phone = renderToStaticMarkup(<NoticeSlot store={s} compact />);
  assert.match(phone, /data-testid="notice-bell"/);
  assert.match(phone, /data-testid="notice-dot"/, "a dot says something needs you");
  assert.doesNotMatch(phone, /Sign-ins locked Unlock/, "a bell, not a line");
});

test("the lock action: the notice's Unlock runs, and Cmd-L locks while unlocked and opens the password sheet while locked", () => {
  const seen: string[] = [];
  let locked = false;
  registerLockControl({ locked: () => locked, lock: async () => { seen.push("lock"); locked = true; }, unlock: () => { seen.push("unlock"); } });
  assert.equal(lockAvailable(), true);
  assert.equal(toggleLock(), true);
  assert.deepEqual(seen, ["lock"]);
  assert.equal(isLocked(), true);
  assert.equal(toggleLock(), true);
  assert.deepEqual(seen, ["lock", "unlock"], "locked: the same key opens the sheet");
  registerLockControl(null);
  assert.equal(toggleLock(), false, "no key to lock here: the key is left alone");
  const s = createNoticeStore();
  let pressed = 0;
  s.raise({ id: "locked", kind: "locked", text: "Sign-ins locked", action: { label: "Unlock", run: () => { pressed++; } } });
  s.getSnapshot().live[0]!.action!.run();
  assert.equal(pressed, 1);
});

test("Cmd-L on a Mac and Ctrl-L elsewhere is Lock Vyre; a terminal keeps Ctrl-L for clearing its screen; it is in the shortcut lists", () => {
  assert.deepEqual(shellKey({ key: "l", metaKey: true }), { type: "lock" });
  assert.deepEqual(shellKey({ key: "L", ctrlKey: true }), { type: "lock" });
  assert.equal(shellKey({ key: "l" }), null, "a plain L is typing");
  assert.deepEqual(matchShortcut({ key: "l", metaKey: true }, "mac"), { id: "vault.lock" });
  assert.deepEqual(matchShortcut({ key: "l", ctrlKey: true }, "other"), { id: "vault.lock" });
  assert.equal(matchShortcut({ key: "l", ctrlKey: true }, "other", { inTerminal: true }), null);
  assert.equal(matchShortcut({ key: "l", ctrlKey: true }, "mac"), null, "Ctrl-L is not the shortcut on a Mac");
  const rows = keyboardRows("mac");
  assert.equal(rows.find((r) => r.id === "vault.lock")?.keys, "⌘L");
  assert.equal(keyboardRows("other").find((r) => r.id === "vault.lock")?.keys, "Ctrl+L");
  assert.ok(SHELL_KEYS.some((k) => k.keys === "Cmd-L"));
  // nothing else in either table uses the same key
  assert.equal(rows.filter((r) => r.keys === "⌘L").length, 1);
});

test("Cmd-K offers Lock Vyre while unlocked and Unlock while locked, and nothing where there is no key to lock", async () => {
  const { gateActions } = await import("../cmdk/gate.ts");
  const base = { away: false, offline: false };
  assert.equal(gateActions(base).some((a) => a.key === "vault.lock"), false, "no key door here: no command");
  assert.deepEqual(gateActions({ ...base, lock: { available: true, locked: false } }).find((a) => a.key === "vault.lock")?.title, "Lock Vyre");
  assert.deepEqual(gateActions({ ...base, lock: { available: true, locked: true } }).find((a) => a.key === "vault.lock")?.title, "Unlock");
});
