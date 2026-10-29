// Search all chats: one box over every chat and channel the person is in. Results are messages, newest-relevant first, each with the chat it is in, who wrote it, when, and the words that matched
// marked. Enter or a click opens that chat on that message and marks it. Keyboard: up and down move, Enter opens, Escape goes back. Right-click: open at the message, open the chat, copy the words.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import type { ScreenHooks } from "../../../../../../client/src/index.ts";
import { Face } from "../needsyou/parts.tsx";
import { Glyph, IconButton } from "../conversation/parts.tsx";
import type { Clock } from "../conversation/model.ts";
import { DEBOUNCE_MS, LIMIT, chatTitle, highlight, statusLine, whenLine } from "./model.ts";
import type { Hit, SearchOut } from "./model.ts";

export interface SearchData {
  screens?: ScreenHooks;
  call(cap: string, input: unknown): Promise<unknown>;
  me: { id: string; name: string };
  nameOf(id: string): string;
  kindOf(id: string): "person" | "agent";
  clock(): Clock;
  /** The words to start with (from /search or a link). */
  query: string;
  /** Open the chat on the message and mark it. */
  openMessage(threadId: string, messageId: string): void;
  openThread(threadId: string): void;
  /** Leave the page: back to the chat that was open. */
  close(): void;
  copy(text: string): void;
}

export function SearchPage({ data }: { data: SearchData }): ReactElement {
  const menu = useMenu();
  const [query, setQuery] = useState(data.query);
  const [out, setOut] = useState<SearchOut | null>(null);
  const [loading, setLoading] = useState(data.query.trim() !== "");
  const [failed, setFailed] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const seq = useRef(0);
  const input = useRef<TextInput | null>(null);

  const run = useCallback((q: string): void => {
    const mine = ++seq.current;
    if (q.trim() === "") { setOut(null); setLoading(false); setFailed(null); return; }
    setLoading(true);
    void Promise.resolve(data.call("chat.search", { q, limit: LIMIT })).then(
      (r) => { if (mine !== seq.current) return; setOut(r as SearchOut); setFailed(null); setLoading(false); setAt(0); },
      (e) => { if (mine !== seq.current) return; setFailed(e instanceof Error && e.message.length < 140 ? e.message : "The search did not run."); setLoading(false); },
    );
  }, [data]);

  useEffect(() => {
    const t = setTimeout(() => run(query), query === data.query ? 0 : DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, run, data.query]);

  const hits = out?.hits ?? [];
  const open = (h: Hit): void => data.openMessage(h.threadId, h.messageId);
  const rows = useMemo(() => hits, [hits]);

  const onKey = (e: unknown): void => {
    const k = (e as { nativeEvent: { key: string }; preventDefault?: () => void }).nativeEvent.key;
    const stop = (): void => (e as { preventDefault?: () => void }).preventDefault?.();
    if (k === "ArrowDown") { stop(); setAt((i) => Math.min(rows.length - 1, i + 1)); }
    else if (k === "ArrowUp") { stop(); setAt((i) => Math.max(0, i - 1)); }
    else if (k === "Enter") { const h = rows[at]; if (h) { stop(); open(h); } }
    else if (k === "Escape") { stop(); data.close(); }
  };

  const status = statusLine(out, loading, query);
  return (
    <View testID="chat-search" accessibilityLabel="Search all chats" style={st.root}>
      <View style={st.head}>
        <IconButton icon="back" label="Back to the chat" size={26} testID="search-back" onPress={() => data.close()} />
        <Glyph name="search" size={15} color="var(--ink-3)" />
        <TextInput
          ref={input} testID="search-input" accessibilityLabel="Search all chats" autoFocus value={query} onChangeText={setQuery} placeholder="Search every chat you are in" placeholderTextColor="var(--ink-4)"
          onKeyPress={onKey as never} style={st.input}
        />
        {query !== "" ? <IconButton icon="x" label="Clear" size={24} testID="search-clear" onPress={() => { setQuery(""); input.current?.focus(); }} /> : null}
      </View>
      {status !== "" ? <Text testID="search-status" accessibilityLiveRegion="polite" style={st.status}>{status}</Text> : null}
      <View style={st.list}>
        {failed ? (
          <States kind="error" message="The search did not run" cause={failed} retryable onRetry={() => run(query)} />
        ) : query.trim() === "" ? (
          <States kind="empty" icon="search" title="Find anything said in any of your chats" />
        ) : !loading && out && rows.length === 0 ? (
          <States kind="empty" icon="search" title={`No messages match "${query.trim()}"`} />
        ) : (
          rows.map((h, i) => <Row key={h.messageId} h={h} i={i} on={i === at} query={query} data={data} onHover={() => setAt(i)} open={() => open(h)} menu={menu} />)
        )}
      </View>
      {menu.element}
    </View>
  );
}

export function Row({ h, i, on, query, data, onHover, open, menu }: { h: Hit; i: number; on: boolean; query: string; data: SearchData; onHover: () => void; open: () => void; menu: ReturnType<typeof useMenu> }): ReactElement {
  const who = data.nameOf(h.author.id);
  const kind = data.kindOf(h.author.id);
  const title = chatTitle(h, data.nameOf, data.me.id);
  const pieces = highlight(h.snippet, query);
  return (
    <Pressable
      testID={`hit-${h.messageId}`} accessibilityRole="button" accessibilityLabel={`${who} in ${title}: ${h.snippet}`} onPress={open} onHoverIn={onHover}
      {...menuTrigger((x, y) => menu.show([
        { label: "Open at This Message", onSelect: open },
        { label: "Open the Chat", onSelect: () => data.openThread(h.threadId) },
        { label: "Copy the Words", onSelect: () => data.copy(h.snippet) },
      ], x, y, "context", { label: "Result" }))}
      style={[st.row, on && st.rowOn]}
    >
      <Face name={who} seedId={h.author.id} kind={kind} size={28} />
      <View style={st.body}>
        <View style={st.meta}>
          <Text numberOfLines={1} style={st.who}>{who}</Text>
          <Text numberOfLines={1} style={st.where}>{`in ${title}`}</Text>
          <Text style={st.when}>{whenLine(h.at, data.clock())}</Text>
          {h.found === "meaning" ? <Text testID={`similar-${i}`} style={st.similar}>similar</Text> : null}
        </View>
        <Text style={st.snippet}>
          {pieces.map((p, j) => (p.mark ? <Text key={j} style={st.mark}>{p.text}</Text> : p.text))}
        </Text>
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  head: { height: 52, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  input: { flex: 1, minWidth: 0, height: 32, fontSize: 15, color: "var(--ink)" as string, outlineStyle: "none", outlineWidth: 0 } as object,
  status: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 4, fontSize: 12.5, color: "var(--ink-3)" as string },
  list: { flex: 1, minHeight: 0, paddingHorizontal: 12, paddingTop: 6, overflow: "scroll" } as object,
  row: { flexDirection: "row", gap: 12, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 10 },
  rowOn: { backgroundColor: "var(--hover)" as string },
  body: { flex: 1, minWidth: 0, gap: 3 },
  meta: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  who: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string, flexShrink: 0 },
  where: { fontSize: 12.5, color: "var(--ink-3)" as string, flexShrink: 1 },
  when: { fontSize: 11.5, color: "var(--ink-4)" as string, marginLeft: "auto" },
  similar: { fontSize: 11, color: "var(--ink-4)" as string, fontStyle: "italic" },
  snippet: { fontSize: 14, lineHeight: 21, color: "var(--ink-2)" as string },
  mark: { color: "var(--ink)" as string, backgroundColor: "var(--accent-wash)" as string, borderRadius: 3 },
});
