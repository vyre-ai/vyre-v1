// Mount for THREADS_01 (lane l-threads), over the sample Northwind Chats Space. ?part=
//   side (default): Intake's chat with a reply thread open beside Intake's booking message; the line under that message says 3 replies, bold (2 are new); the thread's box shows the message
//                   on top and the Following control above it. On a phone width the same thread is a sheet over the chat.
//   page: the Threads page: the threads I am in, newest reply first, two with new replies, one muted, and Show more threads.
//   banners: the banners a reply burst and a mention raise, with Reply.
// The query is read after mount (the static export keeps the first frame's markup), so the first frame is empty and the client draws the same one.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import type { LiveQuery, ScreenHooks } from "../../../client/src/index.ts";
import { ChatsMounted } from "../../../apps/app/src/places/chats/mounts/ChatsMounted.tsx";
import { ThreadsPage } from "../../../apps/app/src/places/chats/mounts/ThreadsPage.tsx";
import { PEOPLE, SAMPLE_NOW, createMountSample } from "../../../apps/app/src/places/chats/mounts/sample.ts";
import { START, step } from "../../../apps/app/src/places/chats/mounts/route.ts";
import { NotificationBanners } from "../../../apps/app/src/shell/notifications/Banners.tsx";
import { BannerStack } from "../../../apps/app/src/shell/notifications/model.ts";
import type { Notification } from "../../../apps/app/src/shell/notifications/model.ts";
import type { ShellRuntime } from "../../../apps/app/src/shell/providers/runtime.tsx";

export const title = "Threads";

const SIDE = "thr_booking";
const at = (h: number, m: number): number => Date.UTC(2025, 9, 24, h, m, 0);
const ready = <T,>(data: T): LiveQuery<T> => { const snap = { status: "ready" as const, data }; return { subscribe: () => () => undefined, getSnapshot: () => snap } as LiveQuery<T>; };
const person = (id: string) => ({ kind: "person" as const, id });

const threadRow = (o: Record<string, unknown>) => ({ kind: "thread", listed: false, planMode: false, mode: "auto", members: [person("usr_irfad"), person("usr_maya"), person("usr_omar")], agents: [], createdAt: at(9, 32), ...o });
const SIDE_ROW = threadRow({ threadId: SIDE, parentThreadId: "c1", parentMessageId: "m4", replyCount: 3, lastMessageAt: at(9, 52), repliers: [person("usr_omar"), person("usr_maya")], unread: 2, following: true, parentTitle: "New client: Elena Rivera" });
const msg = (id: string, who: string, body: string, t: number, seq: number) => ({ messageId: id, threadId: SIDE, threadSeq: seq, author: person(who), kind: "text", body, blocks: [], depth: 0, attachments: [], reactions: [], pinned: false, createdAt: t, enc: 0 });
const SIDE_MESSAGES = [
  msg("r1", "usr_irfad", "Can Maya take Tuesday 2pm, or is that her court morning?", at(9, 40), 1),
  msg("r2", "usr_maya", "Tuesday 2pm works. Court is Thursday.", at(9, 47), 2),
  msg("r3", "usr_omar", "I'll prep the conflict check before then.", at(9, 52), 3),
];

const PAGE_ROWS = [
  SIDE_ROW,
  threadRow({ threadId: "thr_lee", parentThreadId: "chn_intake", parentMessageId: "x1", replyCount: 5, lastMessageAt: at(9, 41), repliers: [person("usr_maya")], unread: 1, following: true, parentTitle: "#intake", preview: "The Lee file has the signed retainer now" }),
  threadRow({ threadId: "thr_fees", parentThreadId: "chn_billing", parentMessageId: "x2", replyCount: 2, lastMessageAt: at(8, 15), repliers: [{ kind: "agent", id: "agt_billing" }, person("usr_omar")], unread: 0, following: true, parentTitle: "#billing", preview: "October invoices are out, 12 of 12 sent" }),
  threadRow({ threadId: "thr_hire", parentThreadId: "chn_team", parentMessageId: "x3", replyCount: 9, lastMessageAt: at(8, 2) - 86_400_000, repliers: [person("usr_omar")], unread: 0, following: false, muted: true, parentTitle: "#team", preview: "Second round is Friday" }),
  threadRow({ threadId: "thr_docs", parentThreadId: "c2", parentMessageId: "x4", replyCount: 1, lastMessageAt: at(7, 30) - 2 * 86_400_000, repliers: [{ kind: "agent", id: "agt_docs" }], unread: 0, following: true, parentTitle: "Engagement letter" }),
].map((r, i) => (i === 0 ? { ...r, preview: "I'll prep the conflict check before then." } : r));

const banner = (id: string, o: Partial<Notification>): Notification => ({ id, kind: "reply.thread", level: "interrupt", place: "chats", title: "", count: 1, at: SAMPLE_NOW, actions: [{ label: "Reply", cap: "chat.post" }], spaceId: "northwind", subject: { type: "thread", id: SIDE }, ...o }) as Notification;

function withThreads(rt: ShellRuntime): ShellRuntime {
  const base = rt.screens;
  const screens: ScreenHooks = {
    query(id, name, state = {}) {
      const s = state as Record<string, unknown>;
      if (id === "chats.right-pane" && name === "threads" && s["threadId"] === "c1") return ready({ threads: [SIDE_ROW], total: 1 });
      if (id === "chats.conversation" && s["threadId"] === SIDE) {
        if (name === "thread") return ready({ thread: SIDE_ROW });
        if (name === "messages") return ready({ messages: SIDE_MESSAGES, hasMore: false });
        if (name === "helpers") return ready({ helpers: [] });
      }
      if (id === "chats.threads" && name === "threads") return ready({ threads: PAGE_ROWS, total: 7, next: "thr_docs" });
      return base.query(id, name, state);
    },
  };
  return {
    ...rt, screens,
    async call(cap, input) {
      const i = input as Record<string, unknown>;
      if (cap === "threads.get" && i["threadId"] === SIDE) return { thread: SIDE_ROW };
      if (cap === "chat.message.get" && i["messageId"] === "m4") return { message: { messageId: "m4", author: { kind: "agent", id: "agt_intake" }, body: "Booked Tuesday at 2:00 with Maya. Elena gets the invite with the form link, and I'll post in #intake when the form comes back." } };
      if ((cap === "threads.mark_read" || cap === "chat.catch_up") && i["threadId"] === SIDE) return cap === "threads.mark_read" ? { unread: 0 } : { unread: 0, since: 0, top: 3, people: [], tasks: [], decisions: [], at: [] };
      return rt.call(cap, input);
    },
  };
}

export default function Mount(): ReactNode {
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const part = useMemo(() => new URLSearchParams(search ?? "").get("part") ?? "side", [search]);
  const rt = useMemo(() => withThreads(createMountSample({ who: "member" }).rt), []);
  const [stack] = useState(() => {
    const s = new BannerStack(() => SAMPLE_NOW);
    s.push(banner("ntf_1", { title: "3 new replies in New client: Elena Rivera", body: "I'll prep the conflict check before then.", count: 3 }));
    s.push(banner("ntf_2", { kind: "mention", title: "Maya Chen mentioned you in #intake", body: "@Irfad can you sign off the Lee retainer?", subject: { type: "thread", id: "thr_lee" } }));
    return s;
  });
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  const nameOf = (id: string): string => PEOPLE.find((p) => p.id === id)?.name ?? id;
  if (part === "page") return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}><ThreadsPage rt={rt} nameOf={nameOf} openChat={() => undefined} /></View>;
  if (part === "banners") return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}><NotificationBanners stack={stack} onAction={() => undefined} onOpen={() => undefined} /></View>;
  const shown = step(START, { t: "chat", threadId: "c1", focus: "m4", side: SIDE });
  return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}><ChatsMounted key={search} rt={rt} initial={shown} window={{ start: 0, end: 500 }} /></View>;
}
