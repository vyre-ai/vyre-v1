// Mount for lane l-taskfix. ?part=
//   sidebar       the Chats sidebar with the Artifacts row above the list: the first chat row must sit fully clear of it
//   held-send     the real task page of a held "Send a message" approval: the message (to, subject, words) and Allow / Deny
//   held-expired  the same request after it expired: when, and no Allow or Deny
//   held-denied   the same request after it was denied: Not approved, nothing left to press
//   held-own      an approval held for the reader's own agent: Waiting for your approval, no "You to You" path
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { createThemeController } from "../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../ui/src/theme/index.ts";
import { ChatsSidebar } from "../../../apps/app/src/places/chats/sidebar/ChatsSidebar.tsx";
import { createSampleSidebar, northwind } from "../../../apps/app/src/places/chats/sidebar/sample.ts";
import { TaskDetail } from "../../../apps/app/src/places/chats/tasks/TaskDetail.tsx";

export const title = "Held send approval states and the sidebar's first row";

const NOW = Date.UTC(2026, 10, 6, 10, 0, 0);
const ME = "usr_irfad";
type Row = Record<string, unknown>;
const PEOPLE = [{ id: ME, name: "Irfad Imtiaz", kind: "person" }, { id: "agt_scout", name: "Scout", kind: "agent" }];
const BLOCK = { type: "doc_excerpt", v: 1, data: { act: "send", cap: "chat.message_person", input: { to: { name: "Aliza Cohen", handle: "aliza" }, subject: "Agency token", body: "Hi Aliza, can you send the agency token when you have a minute? Thanks." } } };
const task = (o: Row): Row => ({
  id: "tsk_held", key: "NW-52", kind: "approve", title: "Send a message to Aliza Cohen", state: "awaiting_approval", blocked: false, blocks: [BLOCK],
  actions: [{ key: "approve", label: "Allow" }, { key: "reject", label: "Deny" }], labels: [], dependsOn: [], fileIds: [], followers: [], workingNotes: {}, reviewLoops: 0,
  assigned: { kind: "person", id: ME }, approver: { kind: "person", id: ME }, createdBy: "agt_scout", yourTurn: true, createdAt: NOW - 600_000, updatedAt: NOW - 300_000, ...o,
});
function pick(part: string): Row {
  if (part === "held-expired") return task({ expiresAt: NOW - 3_600_000 });
  if (part === "held-denied") return task({ state: "canceled", yourTurn: false, actions: [] });
  if (part === "held-own") return task({ createdBy: ME });
  return task({ expiresAt: NOW + 3_600_000 });
}
function runtime(t: Row): unknown {
  const kept = new Map<string, unknown>();
  const live = (data: unknown, key = JSON.stringify(data)) => {
    let snap = kept.get(key);
    if (!snap) { snap = { status: "ready", data }; kept.set(key, snap); }
    return { subscribe: () => () => undefined, getSnapshot: () => snap };
  };
  const screens = {
    query(screen: string, name: string) {
      if (screen === "tasks.page" && name === "task") return live({ task: t });
      if (screen === "tasks.page" && name === "activity") return live({ entries: [], total: 0 });
      return live({});
    },
  };
  return {
    screens, call: async (cap: string) => { if (cap === "tasks.get") return { task: t }; if (cap === "access.groups.list") return { groups: [] }; if (cap === "access.roles.list") return { roles: [] }; if (cap === "tasks.index") return { rev: "r1", unchanged: false, rows: [], doneThisWeek: 0, total: 0 }; return {}; },
    principals: live(PEOPLE), me: { id: ME, name: "Irfad Imtiaz" }, assistant: { id: "agt_assistant", name: "Assistant" },
    clock: () => ({ now: NOW, offsetMin: 300 }), recordTitle: () => undefined, open: () => undefined, openUrl: () => undefined,
    space: { id: "northwind", kind: "team", name: "Northwind" }, aiConnected: true, calendarConnected: true, deferredModules: new Set<string>(), isDeferred: () => false,
  };
}

function Held({ part, skin }: { part: string; skin: string }): ReactNode {
  useMemo(() => {
    const root = (globalThis as { document?: { documentElement?: { setAttribute(n: string, v: string): void; style: { setProperty(n: string, v: string): void; removeProperty(n: string): void } } } }).document?.documentElement;
    const themeRoot: ThemeRoot = { setAttribute: (n, v) => { root?.setAttribute(n, v); }, setProperty: (n, v) => { root?.style.setProperty(n, v); }, removeProperty: (n) => { root?.style.removeProperty(n); } };
    return createThemeController({ personId: "irfad", spaceId: "nw", spaceSkin: { nw: skin }, prefersDark: skin === "graphite", root: themeRoot, storage: null });
  }, [skin]);
  const t = pick(part);
  const rt = useMemo(() => runtime(t) as never, [part]);   // eslint-disable-line react-hooks/exhaustive-deps
  const none = (): void => undefined;
  return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}><TaskDetail rt={rt} taskId="tsk_held" conversationFor={() => { throw new Error("no thread in this sample"); }} openTask={none} openAgent={none} openChat={none} back={none} /></View>;
}

export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")), []);
  const data = useMemo(() => { const s = createSampleSidebar(northwind).data; return { ...s, nav: { ...s.nav, openArtifacts: () => undefined } }; }, []);
  if (q === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  const part = q.get("part") ?? "sidebar";
  if (part === "sidebar") return <View style={{ flex: 1, flexDirection: "row", backgroundColor: "var(--win)" as string }}><View style={{ width: 272, flexShrink: 0 }}><ChatsSidebar data={data as never} window={{ start: 0, end: 500 }} /></View><View style={{ flex: 1 }} /></View>;
  return <Held part={part} skin={q.get("skin") ?? "paper"} />;
}
