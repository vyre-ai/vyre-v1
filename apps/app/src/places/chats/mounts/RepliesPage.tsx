// Replies, in the Inbox: the replies to messages you wrote, replied to, were mentioned in or chose to follow, from the server, newest reply first (audit Threads 4, 6). Each row says which chat it hangs
// off, the newest line and who wrote it, when, and how many replies are new (bold while any are). The same count makes that chat's row in the chat list bold. The list is live: a new reply moves its row to
// the top. Right-click a row for Open, Mark as Read, Follow or Mute, Leave and Copy Link; J and K move, Enter opens. More load on request. A task's replies stay with its task.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
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
/** What the page asks for: the replies I am in, newest reply first, without a task's. */
export const THREADS_STATE = { kind: ["thread"], mine: true, order: "latest", exceptScope: ["task"], limit: PAGE } as const;

export function RepliesPage({ rt, nameOf, openChat, say }: { rt: ShellRuntime; nameOf(id: string): string; openChat(id: string): void; say?(text: string): void }): ReactElement {
  const live = useLive<ThreadsOut>(rt.screens, THREADS_SCREEN, "threads", THREADS_STATE as unknown as Record<string, unknown>);
  const [more, setMore] = useState<{ rows: readonly Thread[]; next: string | undefined } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const menu = useMenu();
  const first = live.status === "ready" ? live.data.threads : [];
  const next = more ? more.next : live.status === "ready" ? live.data.next : undefined;
  const rows = useMemo(() => mergeThreadPages(first, more?.rows ?? []), [first, more]);
  const ids = useMemo(() => rows.map((t) => t.threadId), [rows]);
  const tell = useCallback((text: string) => say?.(text), [say]);

  const loadMore = (): void => {
    if (!next) return;
    void Promise.resolve(rt.call("threads.list", { ...THREADS_STATE, cursor: next })).then(
      (o) => { const out = o as ThreadsOut; setMore((m) => ({ rows: [...(m?.rows ?? []), ...out.threads], next: out.next })); },
      () => tell("Could not load more replies. Try again."),
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
    <ScrollView testID="replies-page" style={LIST_PAGE.root} contentContainerStyle={LIST_PAGE.content}>
      <View style={LIST_PAGE.col}>
        <Text accessibilityRole="header" aria-level={1} style={LIST_PAGE.title}>Replies</Text>
        <View style={LIST_PAGE.rows} accessibilityRole="list">
          {live.status === "ready" && rows.length === 0 ? <Text style={LIST_PAGE.empty}>Replies to messages you wrote, replied to or follow show here.</Text> : null}
          {rows.map((t) => {
            const v = threadView(t, nameOf, clock);
            return (
              <Row
                key={t.threadId} id={`thread-${t.threadId}`} title={v.title} note={v.note} emphasis={v.bold} selected={selected === t.threadId}
                leading={<View style={st.lead}>{v.faces[0] ? <Face name={nameOf(v.faces[0].id)} seedId={v.faces[0].id} kind={v.faces[0].kind} size={28} /> : null}</View>}
                trailing={<View style={st.trail}><Text style={st.when}>{v.when}</Text>{v.unread > 0 ? <Text testID={`thread-unread-${t.threadId}`} accessibilityLabel={`${v.unread} new`} style={st.unread}>{String(v.unread)}</Text> : v.muted ? <Text style={st.when}>Muted</Text> : null}</View>}
                onPress={() => { setSelected(t.threadId); openChat(t.threadId); }}
                domProps={menuTrigger((x, y) => { setSelected(t.threadId); menu.show(entries(t), x, y, "context", { label: "Reply" }); })}
              />
            );
          })}
          {next ? <View style={st.more}><TextButton label="Show more replies" testID="replies-more" onPress={loadMore} /></View> : null}
        </View>
      </View>
      {menu.element}
    </ScrollView>
  );
}

/** The pages at the top of Chats and the Inbox's Replies sit in the column Tasks uses: 700 wide, the title 26 in and 34 down, the rows 16 in, so they read as one family. */
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
