// A reply in the chat the person is reading is not announced in the top bar (lane l-threadreplies): the notice is marked seen at once; a reply in another chat still is announced; a thread under the chat
// being read counts as that chat; opening the chat takes away a notice that was already up.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { installDom, mount, flush } from "../../onboarding/test-dom.ts";
import { useNotificationNotices } from "./bridge.ts";
import type { NotificationNoticesProps } from "./bridge.ts";
import { createNoticeStore } from "./model.ts";
import { viewing } from "./viewing.ts";
import type { Notification } from "../notifications/model.ts";

const note = (id: string, thread: string): Notification => ({ id, kind: "reply.thread", level: "interrupt", place: "chats", title: "Assistant replied in #Vendor onboarding", count: 1, at: 1, subject: { type: "thread", id: thread }, actions: [{ label: "Reply", cap: "chat.post" }], spaceId: "spc_1" }) as Notification;

function setup(items: Notification[], parents: Record<string, string | null> = {}) {
  const store = createNoticeStore();
  const calls: Array<{ cap: string; input: unknown }> = [];
  const listeners = new Set<() => void>();
  const snap = { status: "ready", data: { notifications: items, hasMore: false } };
  const p = {
    query: () => ({ subscribe: (l: () => void) => { listeners.add(l); return () => void listeners.delete(l); }, getSnapshot: () => snap }),
    call: async (cap: string, input: unknown) => { calls.push({ cap, input }); if (cap === "threads.get") return { thread: { parentThreadId: parents[(input as { threadId: string }).threadId] ?? undefined } }; return {}; },
    open: () => undefined,
  } as unknown as NotificationNoticesProps;
  function Probe(): null { useNotificationNotices(p, store); return null; }
  return { store, calls, Probe };
}

test("a reply in the chat being read is marked seen and never raised; one elsewhere is raised", async () => {
  installDom();
  viewing.set(["thr_main"]);
  const s = setup([note("ntf_1", "thr_main"), note("ntf_2", "thr_other")]);
  await mount(createRoot, <s.Probe />);
  await flush();
  const ids = s.store.getSnapshot().live.map((x) => x.id);
  assert.equal(ids.length, 1, "only the other chat's reply is announced");
  assert.ok(s.calls.some((c) => c.cap === "notifications.mark_seen" && JSON.stringify(c.input).includes("ntf_1")), "the one in view is marked seen");
  viewing.set([]);
});

test("a reply in a thread under the chat being read counts as that chat", async () => {
  installDom();
  viewing.set(["thr_main"]);
  const s = setup([note("ntf_3", "thr_under")], { thr_under: "thr_main" });
  await mount(createRoot, <s.Probe />);
  await flush(); await flush();
  assert.equal(s.store.getSnapshot().live.length, 0, "not announced");
  assert.ok(s.calls.some((c) => c.cap === "notifications.mark_seen"));
  viewing.set([]);
});
