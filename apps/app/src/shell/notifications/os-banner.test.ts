// The desktop app's operating system banner (os-banner.ts) and its shell door (os-shell.ts), on spec 2.24's rules (apps/desktop/src/notify.ts): only Interrupt reaches the system, a banner
// carries no content ("Northwind needs you", nothing else), never while the window is in front, one banner per read, at most three a minute then one summary a minute, nothing on a count
// rise, and a notice is bannered once for the life of the window. Its link opens the place through the desktop link the app already routes; a press is not told apart from a focus by the
// shell, so the shell opens nothing by itself (native.rs).
import test from "node:test";
import assert from "node:assert/strict";
import { BANNERS_PER_MINUTE, MEMORY_LIMIT, bannerLink, osBanners, windowFocused } from "./os-banner.ts";
import type { BannerMemory, BannerView } from "./os-banner.ts";
import { bannersRefused, osShell } from "./os-shell.ts";
import { routeDesktopLink } from "../session/desktop.ts";
import type { Notification } from "./model.ts";

const ADDRESS = "https://northwind.example";
const n = (id: string, over: Partial<Notification> = {}): Notification =>
  ({
    id,
    kind: "mention",
    level: "interrupt",
    place: "chats",
    title: "Dana mentioned you in #intake",
    body: "the private words of the message",
    count: 1,
    at: 1,
    actions: [],
    spaceId: "spc_1",
    subject: { type: "thread", id: `thr_${id}` },
    ...over,
  }) as Notification;
let clock = 1_000_000;
const away = (over: Partial<BannerView> = {}): BannerView => ({
  focused: false,
  address: ADDRESS,
  spaceName: "Northwind",
  now: clock,
  ...over,
});
const start = (): BannerMemory => osBanners([], null, away()).memory;

test("nothing is bannered for what was already there when the app opened; a new notice gets one banner, which says only who needs you", () => {
  const first = osBanners([n("a")], null, away());
  assert.deepEqual(first.banners, [], "the first read only remembers");
  const second = osBanners([n("a"), n("b")], first.memory, away());
  assert.deepEqual(
    second.banners.map((b) => [b.title, b.body]),
    [["Northwind needs you", ""]],
  );
  assert.ok(!JSON.stringify(second.banners).includes("Dana"), "no words of the notice: not the line, not the body");
  assert.ok(!JSON.stringify(second.banners).includes("private words"));
  assert.deepEqual(
    osBanners([n("a"), n("b")], second.memory, away()).banners,
    [],
    "the same notice again is not bannered again",
  );
});

test("no banner while the window is in front, whichever place it shows; a notice that came while it was in front is not bannered later", () => {
  const m = start();
  const r = osBanners([n("a", { subject: undefined, place: "inbox" }), n("b")], m, away({ focused: true }));
  assert.deepEqual(r.banners, []);
  assert.deepEqual(
    osBanners([n("a", { subject: undefined, place: "inbox" }), n("b")], r.memory, away()).banners,
    [],
    "seen in the app, not news to the system later",
  );
});

test("a count rise (a burst collapsed into one row, an agent repeating itself) is not another banner", () => {
  const m = osBanners([n("a", { kind: "reply.thread" })], null, away()).memory;
  assert.deepEqual(osBanners([n("a", { kind: "reply.thread", count: 3 })], m, away()).banners, []);
});

test("one banner per read: one notice opens its own thing; several open the Inbox", () => {
  const one = osBanners([n("a")], start(), away()).banners;
  assert.equal(one.length, 1);
  assert.equal(
    routeDesktopLink({ action: "open", params: Object.fromEntries(new URL(one[0]!.link).searchParams) })?.kind,
    "signin",
  );
  assert.match(one[0]!.link, /kind=thread&id=thr_a$/);
  const many = osBanners(
    ["a", "b", "c", "d", "e"].map((id) => n(id, { at: id.charCodeAt(0) })),
    start(),
    away(),
  ).banners;
  assert.deepEqual(
    many.map((b) => [b.title, b.body]),
    [["Northwind needs you", ""]],
  );
  assert.match(many[0]!.link, /kind=place&id=inbox$/);
});

test("over time: three a minute, then one summary a minute, then three again once the minute has rolled", () => {
  let m = start();
  const shown: string[] = [];
  const at = (t: number, id: string): void => {
    const r = osBanners([n(id)], m, away({ now: t }));
    m = r.memory;
    for (const b of r.banners) shown.push(`${t}:${b.tag === "ntf:summary" ? "summary" : "one"}`);
  };
  for (let i = 0; i < 6; i++) at(clock + i * 1000, `x${i}`);
  assert.deepEqual(
    shown,
    [`${clock}:one`, `${clock + 1000}:one`, `${clock + 2000}:one`, `${clock + 3000}:summary`],
    "three, then one summary, then quiet",
  );
  assert.match(String(shown.at(-1)), /summary/);
  at(clock + 40_000, "y1");
  assert.equal(shown.length, 4, "still inside the summary's minute");
  at(clock + 64_000, "y2");
  assert.equal(shown.length, 5, "a minute after the first, there is room again");
});

test("a notice pushed out of the list and back (more than the twenty shown) is not new again; the memory is bounded", () => {
  let m = start();
  m = osBanners([n("a")], m, away()).memory;
  m = osBanners([n("b")], m, away({ now: clock + 61_000 })).memory;
  assert.deepEqual(
    osBanners([n("a")], m, away({ now: clock + 122_000 })).banners,
    [],
    "a came back into the list: not bannered again",
  );
  let big = start();
  big = osBanners(
    Array.from({ length: MEMORY_LIMIT + 50 }, (_, i) => n(`m${i}`)),
    big,
    away({ focused: true }),
  ).memory;
  assert.ok(big.ids.size <= MEMORY_LIMIT);
  assert.ok(BANNERS_PER_MINUTE === 3);
});

test("a kind the person keeps off the desktop (phone only) gets no banner", () => {
  assert.deepEqual(osBanners([n("a")], start(), away({ allows: (k) => k !== "mention" })).banners, []);
});

test("the link: a thing through the desktop link the app already routes (then reach); a place opens that place; a subject no link opens falls back to the row's place", () => {
  assert.deepEqual(
    routeDesktopLink({ action: "open", params: Object.fromEntries(new URL(bannerLink(n("a"), ADDRESS)).searchParams) }),
    { kind: "signin", address: ADDRESS, item: { kind: "thread", id: "thr_a" } },
  );
  assert.deepEqual(
    routeDesktopLink({
      action: "open",
      params: Object.fromEntries(new URL(bannerLink({ place: "inbox" }, ADDRESS)).searchParams),
    }),
    { kind: "signin", address: ADDRESS, item: { kind: "place", id: "inbox" } },
  );
  assert.match(
    bannerLink({ subject: { type: "space", id: "spc_1" }, place: "console" }, ADDRESS),
    /kind=place&id=console$/,
  );
});

test("the window counts as focused only when it is visible and has focus", () => {
  assert.equal(windowFocused({ hasFocus: () => true, visibilityState: "visible" }), true);
  assert.equal(windowFocused({ hasFocus: () => false, visibilityState: "visible" }), false);
  assert.equal(windowFocused({ hasFocus: () => true, visibilityState: "hidden" }), false);
  assert.equal(windowFocused(undefined), false);
});

test("the shell door: notify and set_badge (once per change, 0 clears); only a refusal by the system says banners are off, not any error; none in a browser", async () => {
  assert.equal(osShell({}), null, "a browser has no shell");
  const calls: Array<[string, Record<string, unknown> | undefined]> = [];
  let fail: string | null = null;
  const shell = osShell({
    __TAURI__: {
      core: {
        invoke: async (cmd: string, args?: Record<string, unknown>) => {
          calls.push([cmd, args]);
          if (cmd === "notify" && fail) throw fail;
          return null;
        },
      },
    },
  })!;
  shell.badge(3);
  shell.badge(3);
  shell.badge(0);
  shell.notify({ title: "Northwind needs you", body: "", link: "vyre://open?address=x" });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(
    calls.map(([c, a]) => `${c}:${JSON.stringify(a)}`),
    [
      'set_badge:{"count":3}',
      'set_badge:{"count":0}',
      'notify:{"title":"Northwind needs you","body":"","link":"vyre://open?address=x"}',
    ],
  );
  fail = "a notification link must be a vyre://open link";
  shell.notify({ title: "t", body: "", link: "bad" });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(bannersRefused.get(), false, "a bad link is not the system refusing banners");
  fail = "Notifications permission denied";
  shell.notify({ title: "t", body: "", link: "vyre://open?address=x" });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(bannersRefused.get(), true, "Settings, Notifications says banners are off");
  bannersRefused.set(false);
});
