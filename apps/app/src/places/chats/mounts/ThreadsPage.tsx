// Threads, at the top of Chats: the threads you are in, from the server, newest reply first (audit Threads 4, 6). You are in one when you wrote the message it hangs off, replied, were
// mentioned or chose Follow; a task's thread stays with its task. Each row says where it hangs, the newest line and who wrote it, when, and how many replies are new (bold while any are).
// The list is live: a new reply moves its thread to the top. Right-click a row for Open, Mark as Read, Follow or Mute, Leave and Copy Link; J and K move, Enter opens. More pages load on request.
// Under them, Ask history: every Ask pane you opened beside something in another place (they stay out of Recent), newest first, so one can be reopened here as a full chat.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import { Face } from "../needsyou/parts.tsx";
import { TextButton } from "../conversation/parts.tsx";
import { useLive } from "./live.ts";
import { mergeThreadPages, moveSelection, threadView, typing } from "./threads-model.ts";
import { followMenu, followSaid, modeOf } from "./thread-side.ts";
import { copy } from "./data.ts";

type ThreadsOut = CapMap["threads.list"]["out"];
type Thread = ThreadsOut["threads"][number];

export const THREADS_SCREEN = "chats.threads";
const PAGE = 50;
/** What the page asks for: the threads I am in, newest reply first, without the threads of tasks. */
export const THREADS_STATE = { kind: ["thread"], mine: true, order: "latest", exceptScope: ["task"], limit: PAGE } as const;

export function ThreadsPage({ rt, nameOf, openChat, say }: { rt: ShellRuntime; nameOf(id: string): string; openChat(id: string): void; say?(text: string): void }): ReactElement {
  const live = useLive<ThreadsOut>(rt.screens, THREADS_SCREEN, "threads", THREADS_STATE as unknown as Record<string, unknown>);
  const [more, setMore] = useState<{ rows: readonly Thread[]; next: string | undefined } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const menu = useMenu();
  const [asks, setAsks] = useState<readonly Thread[]>([]);
  useEffect(() => {
    let on = true;
    // an Ask pane is private to the person who opened it: the list holds only theirs
    void Promise.resolve(rt.call("threads.list", { kind: ["ask"], limit: 100 })).then((o) => { if (on) setAsks((o as ThreadsOut).threads); }, () => undefined);
    return () => { on = false; };
  }, [rt]);
  const first = live.status === "ready" ? live.data.threads : [];
  const next = more ? more.next : live.status === "ready" ? live.data.next : undefined;
  const rows = useMemo(() => mergeThreadPages(first, more?.rows ?? []), [first, more]);
  const ids = useMemo(() => rows.map((t) => t.threadId), [rows]);
  const tell = useCallback((text: string) => say?.(text), [say]);

  const loadMore = (): void => {
    if (!next) return;
    void Promise.resolve(rt.call("threads.list", { ...THREADS_STATE, cursor: next })).then(
      (o) => { const out = o as ThreadsOut; setMore((m) => ({ rows: [...(m?.rows ?? []), ...out.threads], next: out.next })); },
      () => tell("Could not load more threads. Try again."),
    );
  };
  const follow = (id: string, mode: "follow" | "mute" | "leave"): void => {
    void Promise.resolve(rt.call("threads.follow", { threadId: id, mode })).then(() => tell(followSaid(mode)), () => tell("Could not change that. Try again."));
  };
  const markRead = (id: string): void => { void Promise.resolve(rt.call("threads.mark_read", { threadId: id })).catch(() => tell("Could not mark it read. Try again.")); };
  const entries = (t: Thread): MenuEntry[] => [
    { label: "Open", onSelect: () => openChat(t.threadId) },
    { label: "Mark as Read", disabled: !t.unread, onSelect: () => markRead(t.threadId) },
    { separator: true },
    ...followMenu(modeOf(t), (mode) => follow(t.threadId, mode)),
    { separator: true },
    { label: "Copy Link", onSelect: () => copy(`vyre://thread/${t.threadId}`) },
  ];

  // J and K move the selection, Enter opens it; a key typed into a field is the field's
  useEffect(() => {
    const g = globalThis as unknown as { addEventListener?: (t: string, f: (e: KeyboardEvent) => void) => void; removeEventListener?: (t: string, f: (e: KeyboardEvent) => void) => void };
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.key === "Enter" && selected !== null) { e.preventDefault(); openChat(selected); return; }
      const to = moveSelection(ids, selected, e.key);
      if (to !== null) { e.preventDefault(); setSelected(to); }
    };
    g.addEventListener?.("keydown", onKey);
    return () => g.removeEventListener?.("keydown", onKey);
  }, [ids, selected, openChat]);

  const clock = rt.clock();
  return (
    <ScrollView testID="threads-page" style={LIST_PAGE.root} contentContainerStyle={LIST_PAGE.content}>
      <View style={LIST_PAGE.col}>
        <Text accessibilityRole="header" aria-level={1} style={LIST_PAGE.title}>Threads</Text>
        <View style={LIST_PAGE.rows} accessibilityRole="list">
          {live.status === "ready" && rows.length === 0 ? <Text style={LIST_PAGE.empty}>Threads you reply in or are mentioned in show here.</Text> : null}
          {rows.map((t) => {
            const v = threadView(t, nameOf, clock);
            return (
              <Row
                key={t.threadId} id={`thread-${t.threadId}`} title={v.title} note={v.note} emphasis={v.bold} selected={selected === t.threadId}
                leading={<View style={st.lead}>{v.faces[0] ? <Face name={nameOf(v.faces[0].id)} seedId={v.faces[0].id} kind={v.faces[0].kind} size={28} /> : null}</View>}
                trailing={<View style={st.trail}><Text style={st.when}>{v.when}</Text>{v.unread > 0 ? <Text testID={`thread-unread-${t.threadId}`} accessibilityLabel={`${v.unread} new`} style={st.unread}>{String(v.unread)}</Text> : v.muted ? <Text style={st.when}>Muted</Text> : null}</View>}
                onPress={() => { setSelected(t.threadId); openChat(t.threadId); }}
                domProps={menuTrigger((x, y) => { setSelected(t.threadId); menu.show(entries(t), x, y, "context", { label: "Thread" }); })}
              />
            );
          })}
          {next ? <View style={st.more}><TextButton label="Show more threads" testID="threads-more" onPress={loadMore} /></View> : null}
        </View>
        {asks.length > 0 ? (
          <View testID="ask-history">
            <Text accessibilityRole="header" aria-level={2} style={st.head}>Ask history</Text>
            <View style={LIST_PAGE.rows}>
              {asks.map((t) => {
                const who = t.agents[0]?.agentId;
                return <Row key={t.threadId} id={`ask-${t.threadId}`} title={t.title ?? "Ask"} {...(who ? { note: nameOf(who) } : {})} leading={who ? <View style={st.lead}><Avatar name={nameOf(who)} seedId={who} kind="agent" size={28} /></View> : null} onPress={() => openChat(t.threadId)} />;
              })}
            </View>
          </View>
        ) : null}
      </View>
      {menu.element}
    </ScrollView>
  );
}

/** The pages at the top of Chats (Threads, Artifacts) sit in the column Tasks uses: 700 wide, the title 26 in and 34 down, the rows 16 in, so the three read as one family. */
export const LIST_PAGE = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  content: { alignItems: "center", paddingHorizontal: 24, paddingTop: 34, paddingBottom: 40 },
  col: { width: "100%", maxWidth: 700 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: "600", letterSpacing: -0.5, color: "var(--ink)" as string, paddingHorizontal: 26, marginBottom: 14 },
  rows: { paddingHorizontal: 16 },
  empty: { fontSize: 14, color: "var(--ink-3)" as string, paddingHorizontal: 10 },
});

const st = StyleSheet.create({
  lead: { marginRight: 12, width: 28 },
  trail: { flexDirection: "row", alignItems: "center", gap: 10 },
  when: { fontSize: 12, color: "var(--ink-3)" as string },
  unread: { fontSize: 12.5, fontWeight: "700", color: "var(--accent)" as string, minWidth: 14, textAlign: "right" },
  more: { paddingVertical: 12, alignItems: "flex-start", paddingHorizontal: 10 },
  head: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string, paddingHorizontal: 26, marginTop: 26, marginBottom: 8 },
});
