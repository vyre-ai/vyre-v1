// Mount for Threads folded into chats (lane l-learn2): ?part=
//   list (the Chats sidebar with no Threads item: two chats bold with their unread reply count), asks (the same sidebar on the Asks filter),
//   replies (Inbox > Replies: the replies I follow, new ones counted, right-click menu on the rows).
// The query is read after mount (the static export keeps the first frame's markup).
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { ChatsSidebar } from "../../../apps/app/src/places/chats/sidebar/ChatsSidebar.tsx";
import { createSampleSidebar, northwind } from "../../../apps/app/src/places/chats/sidebar/sample.ts";
import { RepliesPage, THREADS_SCREEN } from "../../../apps/app/src/places/chats/mounts/RepliesPage.tsx";
import type { ShellRuntime } from "../../../apps/app/src/shell/providers/runtime.tsx";

export const title = "Threads folded into chats";

const NOW = Date.UTC(2026, 10, 3, 15, 0);
const at = (h: number, m: number): number => Date.UTC(2026, 10, 3, h, m);
const NAMES: Record<string, string> = { usr_leo: "Leo Park", usr_maya: "Maya Chen", usr_priya: "Priya Nair", usr_irfad: "Irfad Imtiaz" };

/** The sample sidebar's own rows, with unread replies on two chats (as chat.recent returns them) and two Ask rows for the Asks filter. */
function sidebar(): ReturnType<typeof createSampleSidebar>["data"] {
  const s = createSampleSidebar(northwind).data;
  const replies = new Map<string, number>();
  return {
    ...s,
    call: async (cap: string, input: unknown) => {
      if (cap === "threads.list") {
        const k = (input as { kind?: string[] }).kind ?? [];
        if (k.includes("ask")) return { threads: [{ threadId: "ask_1", title: "Summarise the Rivera intake", agents: ["agt_assistant"] }, { threadId: "ask_2", title: "What changed on the lease?", agents: ["agt_docs"] }], total: 2 };
      }
      const out = await s.call(cap, input);
      if (cap !== "chat.recent") return out;
      const o = out as Record<string, { threadId: string; repliesUnread?: number }[] | unknown>;
      for (const key of ["today", "yesterday", "earlier"]) {
        const rows = o[key] as { threadId: string; repliesUnread?: number }[] | undefined;
        rows?.forEach((r, i) => { if (key === "today" && i < 2) { const n = i === 0 ? 3 : 1; replies.set(r.threadId, n); r.repliesUnread = n; } });
      }
      return o;
    },
  };
}

const row = (id: string, over: Record<string, unknown>) => ({ threadId: id, kind: "thread", listed: false, planMode: false, members: [], agents: [], createdAt: at(9, 0), ...over });
const REPLIES = { threads: [
  row("thr_1", { parentTitle: "#intake", preview: "Rivera is with me, I will send the form by noon", repliers: [{ kind: "person", id: "usr_leo" }], unread: 3, following: true, lastMessageAt: at(14, 5) }),
  row("thr_2", { parentTitle: "Weinberger intake", preview: "Done. The field list is in the folder", repliers: [{ kind: "person", id: "usr_maya" }], unread: 1, following: true, lastMessageAt: at(13, 20) }),
  row("thr_3", { parentTitle: "#sales", preview: "Thanks, I booked it", repliers: [{ kind: "person", id: "usr_priya" }], unread: 0, following: true, lastMessageAt: at(11, 2) }),
  row("thr_4", { parentTitle: "Lease documents", preview: "Muted: Docs is still drafting", repliers: [{ kind: "person", id: "usr_leo" }], unread: 0, following: true, muted: true, lastMessageAt: at(9, 40) }),
], total: 4 };

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "list"), []);
  const data = useMemo(sidebar, []);
  const rt = useMemo(() => ({
    screens: { query(screenId: string) { if (screenId !== THREADS_SCREEN) throw new Error(screenId); return { subscribe: () => () => undefined, getSnapshot: () => ({ status: "ready", data: REPLIES }) }; } },
    clock: () => ({ now: NOW, offsetMin: 0 }),
    call: async () => ({ threads: [], total: 4 }),
  } as unknown as ShellRuntime), []);
  if (part === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  if (part === "replies") return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}><RepliesPage rt={rt} nameOf={(id) => NAMES[id] ?? id} openChat={() => undefined} /></View>;
  return <View style={{ flex: 1, flexDirection: "row", backgroundColor: "var(--win)" as string }}><View style={{ flex: 1, maxWidth: 272, minWidth: 272 }}><ChatsSidebar data={data} window={{ start: 0, end: 500 }} {...(part === "asks" ? { startFilter: "asks" as const } : {})} /></View><View style={{ flex: 1 }} /></View>;
}
