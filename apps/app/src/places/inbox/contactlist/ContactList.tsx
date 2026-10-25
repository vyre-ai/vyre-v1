// Inbox > list (spec 3.3, 2.18): one line per person (By contact), per conversation (By thread) or per call (Calls only), newest first, a thousand or ten thousand deep.
// The header names what is showing and says how many are unread; the View menu and the filter menu carry checkmarks and counts, never rows of chips. Every line is a ui/Row with
// a face in the leading slot and the time and the inbox it came in on in the trailing slot. Click selects; double click or Enter opens the tab; arrows move the highlight; right-click
// opens the line's menu.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { VirtualList } from "../../../../../../ui/src/VirtualList/index.tsx";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useInboxData, useOnline, useOptionalInboxData, useScreenQuery } from "../sidebar/data.tsx";
import {
  CHANNELS, CHANNEL_LABEL, SCREENS, VIEW_LABEL, callEntry, callsState, contactEntry, isFiltering, listState, listTime, narrow, pinned, scopeTitle, showingNames, threadEntry, unreadMeta,
} from "../sidebar/model.ts";
import type { Channel, ContactRow, Entry, InboxState, Mailbox, View as ViewKind } from "../sidebar/model.ts";
import { Face, Ghost, Glyph, IconButton, pointOf } from "../sidebar/parts.tsx";
import type { IconName } from "../sidebar/parts.tsx";
import { useInboxState } from "../sidebar/state.tsx";

type RowsOut = CapMap["inbox.list_by_contact"]["out"];
type ThreadsOut = CapMap["inbox.list_by_thread"]["out"];
type CallsOut = CapMap["telephony.call.list"]["out"];
type BoxesOut = CapMap["mail.mailbox.list"]["out"];

const DOUBLE_MS = 450;
const QUERY_OF: Record<ViewKind, string> = { contact: "rows", thread: "threads", calls: "calls" };
const CHANNEL_ICON: Record<Channel | "meeting", IconName> = { email: "mail", sms: "sms", call: "call", meeting: "cal" };

/** The View menu: the three views, the current one checked. */
export function viewMenuEntries(state: InboxState, pick: (v: ViewKind) => void): MenuEntry[] {
  const views: ViewKind[] = ["contact", "thread", "calls"];
  return [{ head: "View" }, ...views.map((v) => ({ label: VIEW_LABEL[v], checked: state.view === v, onSelect: () => pick(v) }))];
}

/** The filter menu: Channel, Inbox and Matching, each with how many lines it holds and a checkmark when it narrows the list. */
export function filterMenuEntries(
  state: InboxState,
  all: readonly ContactRow[],
  mailboxes: readonly Mailbox[],
  on: { channel(c: Channel): void; inbox(id: string): void; needsMatch(): void },
): MenuEntry[] {
  const count = (label: string, n: number): string => `${label} (${n})`;
  const byChannel = (c: Channel): number => all.reduce((n, r) => n + ((r.lastChannel === c || (c === "call" && r.lastChannel === "meeting")) ? 1 : 0), 0);
  const entries: MenuEntry[] = [{ head: "Channel" }];
  for (const c of CHANNELS) entries.push({ label: count(CHANNEL_LABEL[c], byChannel(c)), checked: state.channels.includes(c), onSelect: () => on.channel(c) });
  entries.push({ separator: true }, { head: "Inbox" });
  for (const m of mailboxes) entries.push({ label: count(m.title, all.reduce((n, r) => n + (r.mailboxIds.includes(m.id) ? 1 : 0), 0)), checked: state.inboxes.includes(m.id), onSelect: () => on.inbox(m.id) });
  entries.push({ separator: true }, { head: "Matching" });
  entries.push({ label: count("Needs a match", all.reduce((n, r) => n + (r.needsMatch ? 1 : 0), 0)), checked: state.needsMatch, onSelect: on.needsMatch });
  return entries;
}

/** The line's menu: open, read or unread, follow, and the match link when the sender is not matched. */
export function lineMenuEntries(e: Entry, h: { open(): void; read(read: boolean): void; follow(follow: boolean): void; match(): void }): MenuEntry[] {
  const out: MenuEntry[] = [{ label: "Open", onSelect: h.open }];
  if (e.kind === "contact") out.push({ label: e.unread > 0 ? "Mark as Read" : "Mark as Unread", onSelect: () => h.read(e.unread > 0) });
  if (e.kind === "contact" && e.contactId) out.push({ label: e.followed ? "Unfollow" : "Follow", onSelect: () => h.follow(!e.followed) });
  if (e.needsMatch && e.kind !== "call") out.push({ separator: true }, { label: "Match to a record…", onSelect: h.match });
  return out;
}

function Meta({ e, now, offsetMin, narrow: slim }: { e: Entry; now: number; offsetMin: number; narrow: boolean }): ReactElement {
  const data = useInboxData();
  return (
    <View style={styles.meta}>
      {e.needsMatch && e.kind === "contact" ? (
        <Pressable accessibilityRole="link" accessibilityLabel="Match to a record" testID={`match-${e.key}`} onPress={() => data.nav.openMatch(e.openId)} style={styles.match}>
          <Glyph name="link" size={12} color="var(--accent)" /><Text style={styles.matchText}>Match to a record</Text>
        </Pressable>
      ) : null}
      <View style={styles.timeLine}>
        {e.unread > 0 ? <View testID={`unread-${e.key}`} accessibilityLabel="Unread" style={styles.udot} /> : null}
        <Text style={[styles.time, e.unread > 0 && styles.timeUnread]}>{listTime(e.at, now, offsetMin)}</Text>
      </View>
      {slim || !e.via ? null : (
        <View style={styles.via}>
          <Glyph name={CHANNEL_ICON[e.channel]} size={11} />
          <Text numberOfLines={1} style={styles.viaText}>{e.via}</Text>
        </View>
      )}
    </View>
  );
}

/** The frame before data arrives: the header and rows of the real height, so nothing moves when the data lands. */
export function ListLoading({ bare = false }: { bare?: boolean }): ReactElement {
  const bars: ReactElement[] = [];
  for (let i = 0; i < 9; i++) {
    bars.push(<View key={i} style={styles.skRow}><View style={styles.skFace} /><View style={styles.skLines}><View style={[styles.skBar, { width: `${35 + ((i * 11) % 30)}%` }]} /><View style={[styles.skBar, styles.skSmall, { width: `${50 + ((i * 7) % 30)}%` }]} /></View></View>);
  }
  if (bare) return <View testID="inbox-list-loading" accessibilityLabel="Loading">{bars}</View>;
  return (
    <View style={styles.main} testID="inbox-list-loading" accessibilityLabel="Loading">
      <View style={styles.head}><Text accessibilityRole="header" style={styles.h1}>All inboxes</Text></View>
      {bars}
    </View>
  );
}

function List(): ReactElement {
  const data = useInboxData();
  const { state, dispatch } = useInboxState();
  const menu = useMenu();
  const online = useOnline();
  const width = useWindowDimensions().width;
  const slim = width > 0 && width < 560; // 0 is "not measured yet" (server render): draw the wide layout
  const view = state.view;
  const sel = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const [reopen, setReopen] = useState<{ x: number; y: number } | null>(null);

  const q = useScreenQuery<RowsOut | ThreadsOut | CallsOut>(SCREENS.list, QUERY_OF[view], view === "calls" ? callsState(state) : listState(state));
  const everyone = useScreenQuery<RowsOut>(SCREENS.list, "rows");
  const boxes = useScreenQuery<BoxesOut>(SCREENS.sidebar, "mailboxes");

  const mailboxes = boxes.status === "ready" ? boxes.data.mailboxes : [];
  const all = everyone.status === "ready" ? everyone.data.rows : [];
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of all) if (r.contactId) m.set(r.contactId, r.displayName);
    return m;
  }, [all]);

  const entries = useMemo<Entry[]>(() => {
    if (q.status !== "ready") return [];
    const d = q.data;
    let out: Entry[] = [];
    if (view === "contact" && "rows" in d) out = d.rows.map((r) => contactEntry(r, mailboxes));
    else if (view === "thread" && "threads" in d) out = d.threads.map((t) => threadEntry(t, mailboxes, names));
    else if (view === "calls" && "calls" in d) out = d.calls.map((c) => callEntry(c, names));
    return narrow(out, state);
  }, [q, view, mailboxes, names, state]);

  const c = data.clock();
  const call = (cap: string, input: unknown): void => { void data.call(cap, input); };
  const openEntry = (e: Entry): void => {
    if (e.kind === "contact") data.nav.openConversation(e.openId);
    else if (e.kind === "thread") data.nav.openThread(e.openId);
    else data.nav.openCall(e.openId);
  };
  const lineMenu = (e: Entry, x: number, y: number): void => {
    dispatch({ type: "select", key: e.key });
    menu.show(lineMenuEntries(e, {
      open: () => openEntry(e),
      read: (read) => call("inbox.mark_read", { conversationId: e.openId, read }),
      follow: (follow) => { if (e.contactId) call("inbox.follow_set", { contactId: e.contactId, follow }); },
      match: () => data.nav.openMatch(e.openId),
    }), x, y);
  };

  const renderLine = (e: Entry): ReactElement => (
    <View {...menuTrigger((x, y) => lineMenu(e, x, y))}>
      <Row
        id={`line:${e.key}`}
        title={e.name}
        note={e.snippet || "No preview"}
        selected={state.selected === e.key}
        leading={<View style={styles.face}>{pinned(e) ? <Ghost size={32} /> : <Face name={e.name} size={32} />}</View>}
        trailing={<Meta e={e} now={c.now} offsetMin={c.offsetMin} narrow={slim} />}
        onPress={() => {
          const now = Date.now();
          const dbl = sel.current.key === e.key && now - sel.current.at < DOUBLE_MS;
          sel.current = { key: e.key, at: now };
          dispatch({ type: "select", key: e.key });
          if (dbl) openEntry(e);
        }}
      />
    </View>
  );

  const showFilter = (x: number, y: number, s: InboxState): void => {
    const again = (): void => setReopen({ x, y });
    menu.show(filterMenuEntries(s, all, mailboxes, {
      channel: (c) => { dispatch({ type: "channel", channel: c }); again(); },
      inbox: (id) => { dispatch({ type: "inbox", id }); again(); },
      needsMatch: () => { dispatch({ type: "needsMatch" }); again(); },
    }), x, y);
  };
  // the filter menu stays open while you check several lines: it opens again on the new state
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!reopen) return;
    showFilter(reopen.x, reopen.y, state);
    setReopen(null);
  }, [reopen]);

  const onKeyDown = (ev: { key?: string; preventDefault?: () => void }): void => {
    const at = entries.findIndex((e) => e.key === state.selected);
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault?.();
      const next = entries[Math.max(0, Math.min(entries.length - 1, at + (ev.key === "ArrowDown" ? 1 : -1)))];
      if (next) dispatch({ type: "select", key: next.key });
    } else if (ev.key === "Enter" && at >= 0) {
      const e = entries[at];
      if (e) { ev.preventDefault?.(); openEntry(e); }
    }
  };

  const meta = state.scope.kind === "all" ? unreadMeta(entries) : "";
  const showing = showingNames(state, mailboxes);
  const filtered = isFiltering(state) || state.query.trim() !== "";

  return (
    <View style={styles.main} testID="inbox-list" accessibilityLabel={`${scopeTitle(state.scope, mailboxes)}, ${VIEW_LABEL[view]}`}>
      <View style={styles.head} testID="inbox-head">
        <View style={styles.tt}>
          <Text accessibilityRole="header" aria-level={1} style={styles.h1} numberOfLines={1}>{scopeTitle(state.scope, mailboxes)}</Text>
          {meta ? <Text style={styles.metaText} testID="inbox-unread-meta">{meta}</Text> : null}
        </View>
        <View style={styles.grow} />
        <Pressable
          accessibilityRole="button" accessibilityLabel="View" testID="inbox-view"
          onPress={(e) => { const p = pointOf(e); menu.show(viewMenuEntries(state, (v) => dispatch({ type: "view", view: v })), p.x, p.y); }}
          style={({ hovered }: { hovered?: boolean }) => [styles.viewBtn, hovered === true && styles.btnOver]}
        >
          <Glyph name={view === "calls" ? "call" : view === "thread" ? "thread" : "users"} size={14} color="var(--ink-2)" />
          <Text style={styles.viewText}>{VIEW_LABEL[view]}</Text>
          <Glyph name="chevd" size={9} />
        </Pressable>
        <IconButton icon="filter" label="Filter" on={isFiltering(state)} testID="inbox-filter" onPress={(x, y) => showFilter(x, y, state)} />
        <IconButton icon="call" label="Dial" testID="inbox-dial" onPress={() => data.nav.openDialer()} />
      </View>
      {showing.length > 0 ? (
        <View style={styles.showing} testID="inbox-showing">
          <Text style={styles.showingText}>Showing <Text style={styles.showingBold}>{showing.join(", ")}</Text></Text>
          <Text style={styles.sep}>{"·"}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Show all" testID="inbox-showall" onPress={() => dispatch({ type: "showAll" })}><Text style={styles.link}>Show all</Text></Pressable>
        </View>
      ) : null}
      {online ? null : <Text style={styles.offline} accessibilityRole="alert" testID="inbox-offline">Offline, showing your saved copy</Text>}
      {q.status !== "ready" ? <ListLoading bare /> : entries.length === 0 ? (
        <States kind="empty" title={filtered ? "Nothing matches these filters." : view === "calls" ? "No calls yet." : "Nothing here"} icon="inbox" {...(filtered ? { action: { label: "Show all", onPress: () => dispatch({ type: "showAll" }) } } : {})} />
      ) : (
        <View style={styles.listBox} {...({ onKeyDown } as object)}>
          <VirtualList data={entries} rowHeight={44} keyOf={(e) => e.key} renderItem={renderLine} />
        </View>
      )}
      {menu.element}
    </View>
  );
}

export function ContactList(): ReactElement {
  const data = useOptionalInboxData();
  if (!data) return <ListLoading />;
  return <List />;
}

const styles = StyleSheet.create({
  main: { flex: 1, minWidth: 0, backgroundColor: "var(--win)" as string },
  head: { height: 48, flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 18, paddingRight: 10, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  tt: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, flexShrink: 1 },
  h1: { margin: 0, fontSize: 14, fontWeight: "600", letterSpacing: -0.07, color: "var(--ink)" as string },
  metaText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  grow: { flex: 1 },
  viewBtn: { height: 28, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, borderRadius: 7 },
  btnOver: { backgroundColor: "var(--hover)" as string },
  viewText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  showing: { flexDirection: "row", alignItems: "center", gap: 8, height: 30, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  showingText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  showingBold: { fontWeight: "600", color: "var(--ink-2)" as string },
  sep: { fontSize: 12.5, color: "var(--ink-4)" as string },
  link: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
  offline: { fontSize: 12.5, color: "var(--ink-3)" as string, paddingHorizontal: 18, paddingVertical: 6 },
  listBox: { flex: 1, paddingHorizontal: 6, paddingTop: 4 },
  face: { marginRight: 10 },
  meta: { alignItems: "flex-end", justifyContent: "center", minWidth: 96 },
  timeLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  time: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  timeUnread: { color: "var(--ink-2)" as string, fontWeight: "500" },
  udot: { width: 7, height: 7, borderRadius: 7, backgroundColor: "var(--accent)" as string },
  via: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: 150 },
  viaText: { fontSize: 11.5, color: "var(--ink-3)" as string, flexShrink: 1 },
  match: { flexDirection: "row", alignItems: "center", gap: 4 },
  matchText: { fontSize: 11.5, fontWeight: "500", color: "var(--accent)" as string },
  skRow: { flexDirection: "row", alignItems: "center", gap: 12, height: 44, paddingHorizontal: 18 },
  skFace: { width: 32, height: 32, borderRadius: 32, backgroundColor: "var(--hover)" as string },
  skLines: { flex: 1, gap: 6 },
  skBar: { height: 9, borderRadius: 5, backgroundColor: "var(--hover)" as string },
  skSmall: { height: 8, opacity: 0.7 },
});
