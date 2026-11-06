// The top bar's notifications slot (owner, 4 Nov): priority order, persisting versus passing, the +N and its popover, the lock action, and Cmd-L.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createNoticeStore, PASSING_MS, PRIORITY, slotView } from "./model.ts";
import { NoticeSlot } from "./NoticeSlot.tsx";
import { PhoneNotices } from "./PhoneNotices.tsx";
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

test("a notice's action runs when pressed", () => {
  const s = createNoticeStore();
  let pressed = 0;
  s.raise({ id: "locked", kind: "locked", text: "Sign-ins locked", action: { label: "Unlock", run: () => { pressed++; } } });
  s.getSnapshot().live[0]!.action!.run();
  assert.equal(pressed, 1);
});

test("Cmd-L is not a shortcut any more: signed in means unlocked, so a plain Cmd-L is left to the page or the browser", () => {
  assert.equal(shellKey({ key: "l", metaKey: true }), null);
  assert.equal(shellKey({ key: "L", ctrlKey: true }), null);
  assert.equal(matchShortcut({ key: "l", metaKey: true }, "mac"), null);
  assert.equal(keyboardRows("mac").some((r) => r.id === "vault.lock"), false);
  assert.equal(SHELL_KEYS.some((k) => k.keys === "Cmd-L"), false);
});

test("Cmd-K has no Lock or Unlock command", async () => {
  const { gateActions } = await import("../cmdk/gate.ts");
  assert.equal(gateActions({ away: false, offline: false }).some((a) => a.key === "vault.lock"), false);
});

test("the phone has one slim row with the bell only while something needs the person", () => {
  const c = clock();
  const s = createNoticeStore(c.now);
  assert.equal(renderToStaticMarkup(<PhoneNotices store={s} />), "", "nothing live: no row, no room taken");
  s.raise({ id: "r", kind: "reply", text: "Dana Whitfield replied in #intake", action: act("Open") });
  const h = renderToStaticMarkup(<PhoneNotices store={s} />);
  assert.match(h, /mobile-notices/);
  assert.match(h, /notice-bell/);
  s.pass("Saved");
  s.resolve("r");
  assert.match(renderToStaticMarkup(<PhoneNotices store={s} />), /notice-bell/, "a passing notice shows on the bell too, briefly");
  c.advance(PASSING_MS + 10);
  s.tick();
  assert.equal(renderToStaticMarkup(<PhoneNotices store={s} />), "", "and the row goes when it has passed");
});
