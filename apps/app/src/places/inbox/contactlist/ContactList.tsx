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
import type { RowExtras } from "../sidebar/data.tsx";
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

// a plain object, not a StyleSheet id, so the painted token is visible in the element's inline style (as ui/Row does)
const BANNER = { backgroundColor: "var(--accent-wash)" };
const DOUBLE_MS = 450;
const QUERY_OF: Record<ViewKind, string> = { contact: "rows", thread: "threads", calls: "calls" };
const CHANNEL_ICON: Record<Channel | "meeting", IconName> = { email: "mail", sms: "sms", call: "call", meeting: "cal" };

/** The View menu: the three views, the current one checked. */
export function viewMenuEntries(state: InboxState, pick: (v: ViewKind) => void): MenuEntry[] {
  const views: ViewKind[] = ["contact", "thread", "calls"];
  return [{ head: "View" }, ...views.map((v) => ({ label: VIEW_LABEL[v], checked: state.view === v, onSelect: () => pick(v) }))];
}

/** The filter menu: Channel, Inbox and Matching, each with how many lines it holds (in the Menu's count column, never in the label) and a checkmark when it narrows the list. */
export function filterMenuEntries(
  state: InboxState,
  all: readonly ContactRow[],
  mailboxes: readonly Mailbox[],
  on: { channel(c: Channel): void; inbox(id: string): void; needsMatch(): void },
): MenuEntry[] {
  const byChannel = (c: Channel): number => all.reduce((n, r) => n + ((r.lastChannel === c || (c === "call" && r.lastChannel === "meeting")) ? 1 : 0), 0);
  const entries: MenuEntry[] = [{ head: "Channel" }];
  for (const c of CHANNELS) entries.push({ label: CHANNEL_LABEL[c], count: byChannel(c), checked: state.channels.includes(c), onSelect: () => on.channel(c) });
  entries.push({ separator: true }, { head: "Inbox" });
  for (const m of mailboxes) entries.push({ label: m.title, count: all.reduce((n, r) => n + (r.mailboxIds.includes(m.id) ? 1 : 0), 0), checked: state.inboxes.includes(m.id), onSelect: () => on.inbox(m.id) });
  entries.push({ separator: true }, { head: "Matching" });
  entries.push({ label: "Needs a match", count: all.reduce((n, r) => n + (r.needsMatch ? 1 : 0), 0), checked: state.needsMatch, onSelect: on.needsMatch });
  return entries;
}

/** The line's menu: open, read or unread, follow, and the match link when the sender is not matched. */
export function lineMenuEntries(e: Entry, h: { open(): void; read(read: boolean): void; follow(follow: boolean): void; star(on: boolean): void; match(): void }): MenuEntry[] {
  const out: MenuEntry[] = [{ label: "Open", onSelect: h.open }];
  if (e.kind === "contact") out.push({ label: e.unread > 0 ? "Mark as Read" : "Mark as Unread", onSelect: () => h.read(e.unread > 0) });
  if (e.kind === "contact" && e.contactId) out.push({ label: e.followed ? "Unfollow" : "Follow", onSelect: () => h.follow(!e.followed) });
  if (e.kind === "contact" && e.contactId) out.push({ label: e.starred ? "Unstar" : "Star", onSelect: () => h.star(!e.starred) });
  if (e.needsMatch && e.kind !== "call") out.push({ separator: true }, { label: "Match to a record…", onSelect: h.match });
  return out;
}

/** A small tag after the name (DND, Bounced, Unmatched): quiet, with the warning colour only for a bounce. */
function Tag({ label, tip, warn = false, id }: { label: string; tip: string; warn?: boolean; id: string }): ReactElement {
  return <Text testID={id} accessibilityLabel={tip} {...({ title: tip } as object)} style={[styles.tag, warn && styles.tagWarn]}>{label}</Text>;
}

/** The trailing slot of a line: the marks (bell, star, tags), the time or, on hover and selection, the More button, and the inbox it came in on. */
function Meta({ e, x, now, offsetMin, narrow: slim, lit, onMore }: { e: Entry; x: RowExtras | undefined; now: number; offsetMin: number; narrow: boolean; lit: boolean; onMore: (px: number, py: number) => void }): ReactElement {
  const data = useInboxData();
  return (
    <View style={styles.meta}>
      {e.needsMatch && e.kind === "contact" ? (
        <Pressable accessibilityRole="link" accessibilityLabel="Match to a record" testID={`match-${e.key}`} onPress={() => data.nav.openMatch(e.openId)} style={styles.match}>
          <Glyph name="link" size={12} color="var(--accent)" /><Text style={styles.matchText}>Match to a record</Text>
        </Pressable>
      ) : null}
      <View style={styles.timeLine}>
        {x?.dnd ? <Tag id={`dnd-${e.key}`} label="DND" tip={`Do not disturb: ${x.dnd}`} /> : null}
        {x?.bounced ? <Tag id={`bounced-${e.key}`} label="Bounced" tip={`An email to ${x.bounced} bounced`} warn /> : null}
        {e.followed ? <View testID={`bell-${e.key}`} accessibilityLabel="Following"><Glyph name="bell" size={12} /></View> : null}
        {e.starred ? <View testID={`star-${e.key}`} accessibilityLabel="Starred"><Glyph name="star" size={12} fill color="var(--warn)" /></View> : null}
        {lit ? (
          <Pressable accessibilityRole="button" accessibilityLabel="More" testID={`more-${e.key}`} onPress={(ev) => { const p = pointOf(ev); onMore(p.x, p.y); }} style={({ hovered }: { hovered?: boolean }) => [styles.more, hovered === true && styles.moreOver]}>
            <Glyph name="more" size={14} />
          </Pressable>
        ) : (
          <>
            {e.unread > 0 ? <View testID={`unread-${e.key}`} accessibilityLabel="Unread" style={styles.udot} /> : null}
            <Text style={[styles.time, e.unread > 0 && styles.timeUnread]}>{listTime(e.at, now, offsetMin)}</Text>
          </>
        )}
      </View>
      {slim || !e.via ? null : (
        <View style={styles.via}>
          <Glyph name={e.missed ? "call" : CHANNEL_ICON[e.channel]} size={13} />
          <Text numberOfLines={1} style={styles.viaText}>{e.via}</Text>
        </View>
      )}
    </View>
  );
}

/** The unmatched sender: not a Row but its own accent-wash block, with the "Match to a record" button on the right (prototype Inbox, the pinned line). */
function Banner({ e, now, offsetMin, selected, onPress, onMore }: { e: Entry; now: number; offsetMin: number; selected: boolean; onPress: () => void; onMore: (px: number, py: number) => void }): ReactElement {
  const data = useInboxData();
  return (
    <View testID={`row-line:${e.key}`} style={styles.bannerSlot} {...menuTrigger(onMore)}>
      <Pressable accessibilityRole="button" accessibilityLabel={e.name} accessibilityState={{ selected }} onPress={onPress} style={({ hovered }: { hovered?: boolean }) => [styles.banner, BANNER, (hovered === true || selected) && styles.bannerOver]}>
        <View style={styles.face}><Ghost size={36} /></View>
        <View style={styles.bannerText}>
          <Text numberOfLines={1} style={styles.bannerName}>{e.name}</Text>
          <Text numberOfLines={1} style={styles.bannerNote}>{e.snippet || "No preview"}</Text>
        </View>
        <View style={styles.bannerRight}>
          <View style={styles.timeLine}>
            {e.unread > 0 ? <View testID={`unread-${e.key}`} accessibilityLabel="Unread" style={styles.udot} /> : null}
            <Text style={[styles.time, e.unread > 0 && styles.timeUnread]}>{listTime(e.at, now, offsetMin)}</Text>
          </View>
          <Pressable accessibilityRole="link" accessibilityLabel="Match to a record" testID={`match-${e.key}`} onPress={() => data.nav.openMatch(e.openId)} style={({ hovered }: { hovered?: boolean }) => [styles.matchBtn, hovered === true && styles.matchBtnOver]}>
            <Glyph name="link" size={12} color="var(--accent)" /><Text style={styles.matchText}>Match to a record</Text>
          </Pressable>
        </View>
      </Pressable>
    </View>
  );
}

/** One line: the shared Row (tall, org as the muted suffix, bold name while unread), with hover tracked here so the trailing slot can swap the time for the More button. */
function Line({ e, x, selected, slim, now, offsetMin, onPress, onMore }: { e: Entry; x: RowExtras | undefined; selected: boolean; slim: boolean; now: number; offsetMin: number; onPress: () => void; onMore: (px: number, py: number) => void }): ReactElement {
  const [over, setOver] = useState(false);
  if (pinned(e)) return <Banner e={e} now={now} offsetMin={offsetMin} selected={selected} onPress={onPress} onMore={onMore} />;
  // "Draft ready" leads the note as plain text until the Row's accent lead-in lands (P-UI_09b)
  const draft = x?.draftReady === true && e.kind === "contact";
  return (
    <View {...menuTrigger(onMore)} {...({ onMouseEnter: () => setOver(true), onMouseLeave: () => setOver(false) } as object)}>
      <Row
        id={`line:${e.key}`}
        title={e.name}
        {...(x?.org ? { titleSuffix: x.org } : {})}
        tall
        emphasis={e.unread > 0}
        note={`${draft ? "Draft ready \u00b7 " : ""}${e.snippet || "No preview"}`}
        selected={selected}
        leading={<View style={styles.face}><Face name={e.name} size={36} /></View>}
        trailing={<Meta e={e} x={x} now={now} offsetMin={offsetMin} narrow={slim} lit={over || selected} onMore={onMore} />}
        onPress={onPress}
      />
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
      // the contract has no conversation resource type: a person is starred through their record, as Follow goes through the contact
      star: (on) => { if (e.contactId) call("stars.toggle", { resource: { type: "record", id: e.contactId }, on }); },
      match: () => data.nav.openMatch(e.openId),
    }), x, y);
  };

  const renderLine = (e: Entry): ReactElement => (
    <Line
      e={e} x={data.extras?.(e.key)} selected={state.selected === e.key} slim={slim} now={c.now} offsetMin={c.offsetMin}
      onMore={(x, y) => lineMenu(e, x, y)}
      onPress={() => {
        const now = Date.now();
        const dbl = sel.current.key === e.key && now - sel.current.at < DOUBLE_MS;
        sel.current = { key: e.key, at: now };
        dispatch({ type: "select", key: e.key });
        if (dbl) openEntry(e);
      }}
    />
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
          <VirtualList data={entries} rowHeight={62} keyOf={(e) => e.key} renderItem={renderLine} />
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
  face: { marginRight: 12 },
  meta: { alignItems: "flex-end", justifyContent: "center", minWidth: 96 },
  timeLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  time: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  timeUnread: { color: "var(--accent)" as string, fontWeight: "500" },
  tag: { fontSize: 10.5, fontWeight: "600", letterSpacing: 0.2, paddingVertical: 1, paddingHorizontal: 5, borderRadius: 5, color: "var(--ink-3)" as string, backgroundColor: "var(--sunk)" as string, boxShadow: "inset 0 0 0 1px var(--line)" as string },
  tagWarn: { color: "var(--warn)" as string },
  more: { width: 24, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sel-strong)" as string },
  moreOver: { backgroundColor: "var(--press)" as string },
  udot: { width: 7, height: 7, borderRadius: 7, backgroundColor: "var(--accent)" as string },
  via: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: 150 },
  viaText: { fontSize: 11.5, color: "var(--ink-3)" as string, flexShrink: 1 },
  match: { flexDirection: "row", alignItems: "center", gap: 4 },
  matchText: { fontSize: 11.5, fontWeight: "500", color: "var(--accent)" as string },
  bannerSlot: { height: 62, paddingHorizontal: 0, justifyContent: "flex-start" },
  banner: { height: 56, flexDirection: "row", alignItems: "center", paddingLeft: 8, paddingRight: 12, borderRadius: 6 },
  bannerOver: { backgroundColor: "color-mix(in srgb, var(--accent) 16%, transparent)" as string },
  bannerText: { flex: 1, minWidth: 0 },
  bannerName: { fontSize: 13, lineHeight: 18, fontWeight: "600", color: "var(--ink)" as string },
  bannerNote: { fontSize: 11.5, lineHeight: 16, color: "var(--ink-3)" as string },
  bannerRight: { alignItems: "flex-end", gap: 2, marginLeft: 8 },
  matchBtn: { flexDirection: "row", alignItems: "center", gap: 5, height: 24, paddingHorizontal: 8, borderRadius: 6 },
  matchBtnOver: { backgroundColor: "var(--win)" as string },
  skRow: { flexDirection: "row", alignItems: "center", gap: 12, height: 44, paddingHorizontal: 18 },
  skFace: { width: 32, height: 32, borderRadius: 32, backgroundColor: "var(--hover)" as string },
  skLines: { flex: 1, gap: 6 },
  skBar: { height: 9, borderRadius: 5, backgroundColor: "var(--hover)" as string },
  skSmall: { height: 8, opacity: 0.7 },
});
