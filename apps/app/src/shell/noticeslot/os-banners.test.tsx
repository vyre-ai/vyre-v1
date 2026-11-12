// The desktop banners through the live notices hook (bridge.ts useNotificationNotices with `os`): the same reads the top bar uses. While the window is in front nothing is bannered, whichever
// chat it shows; in the background a new notice gets one banner that says only who needs you, once; a muted chat's message makes no notification row at all (the server drops it), so nothing
// reaches the banner; a row that is not Interrupt (a kind set to a dot, away, quiet hours) gets none.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { installDom, mount, flush } from "../../onboarding/test-dom.ts";
import { useNotificationNotices } from "./bridge.ts";
import type { NotificationNoticesProps } from "./bridge.ts";
import { createNoticeStore } from "./model.ts";
import { viewing } from "./viewing.ts";
import type { OsBanner } from "../notifications/os-banner.ts";
import type { Notification } from "../notifications/model.ts";

const note = (id: string, thread: string, over: Partial<Notification> = {}): Notification => ({ id, kind: "mention", level: "interrupt", place: "chats", title: `Dana mentioned you (${id})`, count: 1, at: 1, subject: { type: "thread", id: thread }, actions: [], spaceId: "spc_1", ...over }) as Notification;

function setup(focused: boolean) {
  const store = createNoticeStore();
  const listeners = new Set<() => void>();
  let items: Notification[] = [];
  const shown: OsBanner[] = [];
  const p = {
    query: () => ({ subscribe: (l: () => void) => { listeners.add(l); return () => void listeners.delete(l); }, getSnapshot: () => ({ status: "ready", data: { notifications: items, hasMore: false } }) }),
    call: async (cap: string) => (cap === "threads.get" ? { thread: {} } : {}),
    open: () => undefined,
    os: { view: () => ({ focused, address: "https://northwind.example", spaceName: "Northwind", now: 1_000_000 }), show: (b: OsBanner) => { shown.push(b); } },
  } as unknown as NotificationNoticesProps;
  function Probe(): null { useNotificationNotices(p, store); return null; }
  const arrive = async (next: Notification[]): Promise<void> => { items = next; for (const l of [...listeners]) l(); await flush(); await flush(); };
  return { Probe, shown, arrive };
}

test("the window in front: no banner, whichever chat it shows", async () => {
  installDom();
  viewing.set(["thr_open"]);
  const s = setup(true);
  await mount(createRoot, <s.Probe />);
  await flush();
  await s.arrive([note("ntf_here", "thr_open"), note("ntf_other", "thr_other")]);
  assert.deepEqual(s.shown, []);
  viewing.set([]);
});

test("in the background: a new notice gets one banner with no content, once", async () => {
  installDom();
  const s = setup(false);
  await mount(createRoot, <s.Probe />);
  await flush();
  await s.arrive([note("ntf_a", "thr_a")]);
  assert.deepEqual(s.shown.map((b) => [b.title, b.body]), [["Northwind needs you", ""]]);
  await s.arrive([note("ntf_a", "thr_a", { count: 2 })]);
  assert.equal(s.shown.length, 1, "not again for the same notice, nor when its count rises");
});

test("a muted chat makes no row, so no banner; a row that is not Interrupt (set to a dot, away, quiet hours) makes none", async () => {
  installDom();
  const s = setup(false);
  await mount(createRoot, <s.Probe />);
  await flush();
  await s.arrive([note("ntf_dot", "thr_x", { level: "badge" }), note("ntf_digest", "thr_y", { level: "digest" })]);
  assert.deepEqual(s.shown, []);
});

test("what was there when the app opened is not bannered", async () => {
  installDom();
  const s = setup(false);
  await s.arrive([note("ntf_old", "thr_z")]);
  await mount(createRoot, <s.Probe />);
  await flush();
  assert.deepEqual(s.shown, []);
});
