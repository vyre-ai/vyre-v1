// Inbox > Unmatched (spec 3.3, 2.18; prototype Inbox "Matching > Unmatched" and the Match menu): every sender or caller that matches no record yet, newest first. A line is the accent-wash block with
// the ghost face, the number or address, the newest words, the time and a "Match to a record" button. The button (and the line's right-click menu) opens the Match menu: the suggestions best first
// with their score, Search Records and Create a Record. A match moves the whole conversation to the record and leaves a quiet line with Undo (no toast); everything works from the local copy and a
// change queues while offline. Double click or Enter opens the conversation.
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { VirtualList } from "../../../../../../ui/src/VirtualList/index.tsx";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { useInboxData, useOnline, useOptionalInboxData, useScreenQuery } from "../sidebar/data.tsx";
import { listTime } from "../sidebar/model.ts";
import { Ghost, Glyph, IconButton, pointOf } from "../sidebar/parts.tsx";
import { EMPTY_LINE, OFFLINE_LINE, SCREEN, createdLine, matchedLine, newestFirst, scorePercent, suggestionLabel, waitingLine } from "./model.ts";
import type { CreateOut, MatchOut, Suggestion, Unmatched, UnmatchedOut } from "./model.ts";

const DOUBLE_MS = 450;
const ROW = 62;
// a plain object, not a StyleSheet id, so the painted token is visible in the element's inline style
const WASH = { backgroundColor: "var(--accent-wash)" };

export interface UnmatchedProps {
  /** "Show all" in the Showing line: the shell goes back to All inboxes. */
  onShowAll?(): void;
  /** "Search Records…" in the Match menu: the shell opens Records search for this person. */
  onSearchRecords?(who: Unmatched): void;
}

const keyOf = (): string => globalThis.crypto.randomUUID();

/** The entries of the Match menu for one line. */
export function matchMenuEntries(suggestions: readonly Suggestion[], on: { match(s: Suggestion): void; search(): void; create(type: "contact" | "company"): void }): MenuEntry[] {
  const out: MenuEntry[] = [{ head: "Suggested" }];
  if (suggestions.length === 0) out.push({ head: "No suggestions yet" });
  for (const s of [...suggestions].sort((a, b) => b.score - a.score)) out.push({ label: suggestionLabel(s), count: scorePercent(s), onSelect: () => on.match(s) });
  out.push({ separator: true }, { label: "Search Records…", onSelect: on.search }, { label: "Create a contact", onSelect: () => on.create("contact") }, { label: "Create a company", onSelect: () => on.create("company") });
  return out;
}

/** Where a menu opened from a button goes: under the button, whatever pointer or keyboard opened it (a press with no coordinates still lands in the same place). */
function anchorOf(e: unknown): { x: number; y: number } {
  const t = ((e as { currentTarget?: unknown; target?: unknown }).currentTarget ?? (e as { target?: unknown }).target) as { getBoundingClientRect?: () => { left: number; bottom: number } } | undefined;
  const r = t?.getBoundingClientRect?.();
  return r ? { x: r.left, y: r.bottom + 4 } : pointOf(e);
}

function Line({ u, selected, now, offsetMin, onPress, onMatch }: { u: Unmatched; selected: boolean; now: number; offsetMin: number; onPress(): void; onMatch(x: number, y: number): void }): ReactElement {
  return (
    <View testID={`unmatched-${u.id}`} style={s.slot} {...menuTrigger(onMatch)}>
      <Pressable accessibilityRole="button" accessibilityLabel={u.displayName || u.address} accessibilityState={{ selected }} onPress={onPress} style={({ hovered }: { hovered?: boolean }) => [s.block, WASH, (hovered === true || selected) && s.over]}>
        <View style={s.face}><Ghost size={36} /></View>
        <View style={s.text}>
          <Text numberOfLines={1} style={[s.name, u.unreadCount > 0 && s.bold]}>{u.displayName || u.address}</Text>
          <Text numberOfLines={1} style={s.note}>{u.lastPreview || "No preview"}</Text>
        </View>
        <View style={s.right}>
          <Text style={[s.time, u.unreadCount > 0 && s.timeUnread]}>{listTime(u.lastMessageAt, now, offsetMin)}</Text>
          <Pressable accessibilityRole="link" accessibilityLabel="Match to a record" testID={`match-${u.id}`} onPress={(e) => { const p = anchorOf(e); onMatch(p.x, p.y); }} style={({ hovered }: { hovered?: boolean }) => [s.btn, hovered === true && s.btnOver]}>
            <Glyph name="link" size={12} color="var(--accent)" /><Text style={s.btnText}>Match to a record</Text>
          </Pressable>
        </View>
      </Pressable>
    </View>
  );
}

function List({ onSearchRecords, onShowAll }: UnmatchedProps): ReactElement {
  const data = useInboxData();
  const menu = useMenu();
  const online = useOnline();
  const q = useScreenQuery<UnmatchedOut>(SCREEN, "rows");
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; undo?: () => void } | null>(null);
  const last = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const clock = data.clock();
  const rows = q.status === "ready" ? newestFirst(q.data.rows) : [];

  const run = async (u: Unmatched, work: () => Promise<{ text: string; undo?: () => void }>): Promise<void> => {
    try { setNote(await work()); } catch (e) { setNote({ text: `Could not do that: ${e instanceof Error ? e.message : "try again"}` }); }
    setSelected((cur) => (cur === u.id ? null : cur));
  };
  const who = (u: Unmatched): string => u.displayName || u.address;
  const match = (u: Unmatched, sg: Suggestion): Promise<void> => run(u, async () => {
    const out = (await data.call("inbox.match", { conversationId: u.id, recordId: sg.recordId, idempotencyKey: keyOf() })) as MatchOut;
    return { text: matchedLine(who(u), sg.name), undo: () => { void run(u, async () => { await data.call("inbox.unmatch", { conversationId: u.id, undoToken: out.undoToken }); return { text: `${who(u)} is unmatched again` }; }); } };
  });
  const create = (u: Unmatched, type: "contact" | "company"): Promise<void> => run(u, async () => {
    const out = (await data.call("inbox.match_new", { conversationId: u.id, type, idempotencyKey: keyOf() })) as CreateOut;
    void out;
    return { text: createdLine(who(u), type) };
  });
  const open = (u: Unmatched, x: number, y: number): void => {
    setSelected(u.id);
    void (async () => {
      let sg: Suggestion[] = [];
      try { sg = ((await data.call("inbox.match_suggestions", { conversationId: u.id })) as { suggestions: Suggestion[] }).suggestions; } catch { /* the menu still offers the two ways out */ }
      menu.show(matchMenuEntries(sg, { match: (x1) => { void match(u, x1); }, search: () => onSearchRecords?.(u), create: (t) => { void create(u, t); } }), x, y);
    })();
  };
  const press = (u: Unmatched): void => {
    const now = Date.now();
    const dbl = last.current.key === u.id && now - last.current.at < DOUBLE_MS;
    last.current = { key: u.id, at: now };
    setSelected(u.id);
    if (dbl) data.nav.openConversation(u.id);
  };
  const renderLine = (u: Unmatched): ReactElement => <Line u={u} selected={selected === u.id} now={clock.now} offsetMin={clock.offsetMin} onPress={() => press(u)} onMatch={(x, y) => open(u, x, y)} />;
  const onKeyDown = (ev: { key?: string; preventDefault?: () => void }): void => {
    const at = rows.findIndex((r) => r.id === selected);
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault?.(); const n = rows[Math.max(0, Math.min(rows.length - 1, at + (ev.key === "ArrowDown" ? 1 : -1)))]; if (n) setSelected(n.id); }
    else if (ev.key === "Enter" && at >= 0) { ev.preventDefault?.(); open(rows[at]!, 0, 0); }
  };

  return (
    <View style={s.main} testID="inbox-unmatched">
      <View style={s.head}>
        <Text accessibilityRole="header" aria-level={1} style={s.h1}>All inboxes</Text>
        {rows.length > 0 ? <Text style={s.meta} testID="unmatched-count">{waitingLine(rows.length)}</Text> : null}
        <View style={s.grow} />
        <IconButton icon="filter" label="Filter" on testID="unmatched-filter" onPress={() => {}} />
        <IconButton icon="call" label="Dial" testID="unmatched-dial" onPress={() => data.nav.openDialer()} />
      </View>
      <View style={s.showing} testID="unmatched-showing">
        <Text style={s.showingText}>Showing <Text style={s.showingBold}>Unmatched</Text></Text>
        <Text style={s.sep}>{"·"}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Show all" testID="unmatched-showall" onPress={() => onShowAll?.()}><Text style={s.link}>Show all</Text></Pressable>
      </View>
      {note ? (
        <View style={s.noteLine} testID="unmatched-note">
          <Text style={s.noteText}>{note.text}</Text>
          {note.undo ? <Pressable accessibilityRole="button" accessibilityLabel="Undo" testID="unmatched-undo" onPress={note.undo}><Text style={s.undo}>Undo</Text></Pressable> : null}
        </View>
      ) : null}
      {online ? null : <Text style={s.offline} accessibilityRole="alert" testID="unmatched-offline">{OFFLINE_LINE}</Text>}
      {q.status !== "ready" ? <View testID="unmatched-loading" accessibilityLabel="Loading" style={s.loading} /> : rows.length === 0 ? (
        <States kind="empty" title={EMPTY_LINE} icon="inbox" />
      ) : (
        <View style={s.listBox} {...({ onKeyDown } as object)}><VirtualList data={rows} rowHeight={ROW} keyOf={(u) => u.id} renderItem={renderLine} /></View>
      )}
      {menu.element}
    </View>
  );
}

export function InboxUnmatched(props: UnmatchedProps): ReactElement {
  const data = useOptionalInboxData();
  if (!data) return <View style={s.main} testID="inbox-unmatched-loading" accessibilityLabel="Loading" />;
  return <List {...props} />;
}

const s = StyleSheet.create({
  main: { flex: 1, minWidth: 0, backgroundColor: "var(--win)" as string },
  head: { height: 48, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  h1: { margin: 0, fontSize: 14, fontWeight: "600", letterSpacing: -0.07, color: "var(--ink)" as string },
  grow: { flex: 1 },
  showing: { flexDirection: "row", alignItems: "center", gap: 8, height: 30, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string, backgroundColor: "var(--side)" as string },
  showingText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  showingBold: { fontWeight: "600", color: "var(--ink-2)" as string },
  sep: { fontSize: 12.5, color: "var(--ink-4)" as string },
  link: { fontSize: 12.5, fontWeight: "600", color: "var(--accent)" as string },
  meta: { fontSize: 12.5, color: "var(--ink-3)" as string },
  noteLine: { flexDirection: "row", alignItems: "center", gap: 10, height: 30, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  noteText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  undo: { fontSize: 12.5, fontWeight: "600", color: "var(--accent)" as string },
  offline: { fontSize: 12.5, color: "var(--ink-3)" as string, paddingHorizontal: 18, paddingVertical: 6 },
  loading: { flex: 1 },
  listBox: { flex: 1, paddingHorizontal: 6, paddingTop: 6 },
  slot: { height: ROW },
  block: { height: 56, flexDirection: "row", alignItems: "center", paddingLeft: 8, paddingRight: 12, borderRadius: 6 },
  over: { backgroundImage: "linear-gradient(color-mix(in srgb, var(--accent) 16%, transparent), color-mix(in srgb, var(--accent) 16%, transparent))" as unknown as undefined },
  face: { marginRight: 12 },
  text: { flex: 1, minWidth: 0 },
  name: { fontSize: 13, lineHeight: 18, color: "var(--ink)" as string },
  bold: { fontWeight: "600" },
  note: { fontSize: 11.5, lineHeight: 16, color: "var(--ink-3)" as string },
  right: { alignItems: "flex-end", gap: 2, marginLeft: 8 },
  time: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  timeUnread: { color: "var(--accent)" as string, fontWeight: "500" },
  btn: { flexDirection: "row", alignItems: "center", gap: 5, height: 24, paddingHorizontal: 8, borderRadius: 6 },
  btnOver: { backgroundColor: "var(--win)" as string },
  btnText: { fontSize: 12, fontWeight: "600", color: "var(--accent)" as string },
});
