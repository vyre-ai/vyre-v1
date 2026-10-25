// Inbox > sidebar (spec 3.3): By contact and All inboxes, Calendar, then Mine, Shared and Agents with their unread counts, the Lists (Following, Campaigns) and the Calendars with
// a colour dot each. Every row is a ui/Row with a leading glyph and a trailing count. Click selects; right-click opens the row's menu; a calendar's click hides or shows it and its
// menu offers Show Only This. The dialer sits at the foot.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useInboxData, useOptionalInboxData, useScreenQuery } from "./data.tsx";
import { SCREENS, calendarIds, navGroups, sameScope } from "./model.ts";
import type { ContactRow, NavInbox, Scope, View as ViewKind } from "./model.ts";
import { Glyph, IconButton, Unread } from "./parts.tsx";
import type { IconName } from "./parts.tsx";
import { useInboxState } from "./state.tsx";

type CountsOut = CapMap["inbox.counts"]["out"];
type BoxesOut = CapMap["mail.mailbox.list"]["out"];
type CalsOut = CapMap["calendar.list_calendars"]["out"];
type RowsOut = CapMap["inbox.list_by_contact"]["out"];

const withMenu = (open: (x: number, y: number) => void): Record<string, unknown> => menuTrigger(open);

function SideRow({ id, title, glyph, selected, count, trailing, dim = false, onPress, onMenu }: {
  id: string; title: string; glyph: ReactElement; selected: boolean; count?: number; trailing?: ReactElement | null; dim?: boolean; onPress: () => void; onMenu?: (x: number, y: number) => void;
}): ReactElement {
  const trig = onMenu ? withMenu(onMenu) : {};
  return (
    <View {...trig} style={dim ? { opacity: 0.45 } : undefined}>
      <Row
        id={`nav:${id}`}
        title={title}
        selected={selected}
        leading={<View style={styles.glyph}>{glyph}</View>}
        trailing={<View style={styles.trail}>{trailing ?? null}{count ? <Unread n={count} /> : null}</View>}
        onPress={onPress}
      />
    </View>
  );
}

function SectionHead({ id, label, closed, onToggle }: { id: string; label: string; closed: boolean; onToggle: () => void }): ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: !closed }} testID={`sec-${id}`} onPress={onToggle} style={({ hovered }: { hovered?: boolean }) => [styles.sec, hovered === true && styles.secOver]}>
      <View style={closed ? styles.chevShut : undefined}><Glyph name="chevd" size={10} /></View>
      <Text style={styles.secText}>{label}</Text>
    </Pressable>
  );
}

/** The frame before data arrives: the search field and rows of the real height. */
export function SidebarLoading(): ReactElement {
  const bars: ReactElement[] = [];
  for (let i = 0; i < 9; i++) bars.push(<View key={i} style={styles.skRow}><View style={styles.skDot} /><View style={[styles.skBar, { width: `${40 + ((i * 17) % 35)}%` }]} /></View>);
  return <View style={styles.side} testID="inbox-sidebar-loading" accessibilityLabel="Loading"><View style={styles.search} />{bars}</View>;
}

function Sidebar(): ReactElement {
  const data = useInboxData();
  const { state, dispatch } = useInboxState();
  const menu = useMenu();
  const [focus, setFocus] = useState(false);
  const counts = useScreenQuery<CountsOut>(SCREENS.sidebar, "counts");
  const boxes = useScreenQuery<BoxesOut>(SCREENS.sidebar, "mailboxes");
  const cals = useScreenQuery<CalsOut>(SCREENS.sidebar, "calendars");
  const rows = useScreenQuery<RowsOut>(SCREENS.list, "rows");

  const mailboxes = boxes.status === "ready" ? boxes.data.mailboxes : [];
  const calendars = cals.status === "ready" ? cals.data.calendars : [];
  const all: readonly ContactRow[] = rows.status === "ready" ? rows.data.rows : [];
  const groups = navGroups(mailboxes, counts.status === "ready" ? counts.data : null);
  const unreadOf = (f: (r: ContactRow) => boolean): number => all.reduce((n, r) => n + (f(r) && r.unreadCount > 0 ? 1 : 0), 0);
  const total = counts.status === "ready" ? counts.data.total : 0;

  const closed = (k: string): boolean => state.closed.includes(k);
  const scoped = (scope: Scope): boolean => state.main === "list" && sameScope(state.scope, scope);
  const pick = (scope: Scope, view?: ViewKind): void => { dispatch({ type: "scope", scope }); if (view) dispatch({ type: "view", view }); };

  const inboxMenu = (b: NavInbox, x: number, y: number): void => {
    const entries: MenuEntry[] = [
      { label: "Open", onSelect: () => pick(b.scope) },
      { label: b.channel === "sms" ? "Number Settings…" : "Mailbox Settings…", onSelect: () => data.nav.openInboxSettings(b.id) },
    ];
    menu.show(entries, x, y);
  };
  const connectMenu = (x: number, y: number): void => {
    menu.show([
      { head: "Connect a mailbox" },
      { label: "Gmail", onSelect: () => data.nav.connect("gmail") },
      { label: "Outlook", onSelect: () => data.nav.connect("outlook") },
      { label: "IMAP", onSelect: () => data.nav.connect("imap") },
      { separator: true },
      { label: "Claim a Twilio number", onSelect: () => data.nav.connect("number") },
    ], x, y);
  };
  const calendarMenu = (id: string, x: number, y: number): void => {
    menu.show([
      { label: "Show Only This", onSelect: () => dispatch({ type: "calendarOnly", id, all: calendarIds(calendars) }) },
      { label: "Show All Calendars", onSelect: () => { for (const hidden of state.hiddenCalendars) dispatch({ type: "calendarVisible", id: hidden }); } },
    ], x, y);
  };

  const sections: ReactElement[] = [];
  for (const g of groups) {
    sections.push(<SectionHead key={`h-${g.key}`} id={g.key} label={g.label} closed={closed(g.key)} onToggle={() => dispatch({ type: "section", key: g.key })} />);
    if (closed(g.key)) continue;
    for (const b of g.items) {
      sections.push(
        <SideRow
          key={b.id} id={`inbox:${b.id}`} title={b.label} selected={scoped(b.scope)} count={b.unread}
          glyph={<Glyph name={b.channel === "sms" ? "call" : "mail"} />}
          trailing={b.lock ? <Glyph name="lock" size={12} /> : null}
          onPress={() => pick(b.scope)}
          onMenu={(x, y) => inboxMenu(b, x, y)}
        />,
      );
    }
  }

  const calendarRows: ReactElement[] = [];
  for (const c of calendars) {
    const off = state.hiddenCalendars.includes(c.id);
    calendarRows.push(
      <SideRow
        key={c.id} id={`cal:${c.id}`} title={c.title} selected={false} dim={off}
        glyph={<View testID={`cal-dot-${c.id}`} style={[styles.dot, { backgroundColor: c.color }]} />}
        trailing={c.personal ? <Glyph name="lock" size={12} /> : null}
        onPress={() => dispatch({ type: "calendarVisible", id: c.id })}
        onMenu={(x, y) => calendarMenu(c.id, x, y)}
      />,
    );
  }

  const list = (key: "follow" | "camp", label: string, glyph: IconName, f: (r: ContactRow) => boolean): ReactElement => (
    <SideRow key={key} id={`list:${key}`} title={label} selected={scoped({ kind: key })} count={unreadOf(f)} glyph={<Glyph name={glyph} />} onPress={() => pick({ kind: key })} />
  );

  return (
    <View style={styles.side} testID="inbox-sidebar" accessibilityLabel="Inbox sidebar">
      <View style={styles.top}>
        <View style={styles.grow} />
        <IconButton icon="pen" label="New message" testID="inbox-new" onPress={() => data.nav.compose()} />
        <IconButton icon="plus" label="Connect a mailbox or number" testID="inbox-connect" onPress={connectMenu} />
      </View>
      <View style={[styles.search, focus && styles.searchOn]}>
        <Glyph name="search" size={13} />
        <TextInput
          value={state.query}
          onChangeText={(q) => dispatch({ type: "query", query: q })}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onKeyPress={(e) => { if (e.nativeEvent.key === "Escape") dispatch({ type: "query", query: "" }); }}
          placeholder="Search"
          placeholderTextColor="var(--ink-3)"
          accessibilityLabel="Search"
          testID="inbox-search"
          autoComplete="off"
          style={styles.input}
        />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollIn} testID="inbox-nav">
        <SideRow id="view:contact" title="By contact" selected={state.main === "list" && state.scope.kind === "all" && state.view !== "thread"} count={total}
          glyph={<Glyph name="users" />} onPress={() => pick({ kind: "all" }, "contact")} />
        <SideRow id="view:thread" title="All inboxes" selected={state.main === "list" && state.scope.kind === "all" && state.view === "thread"}
          glyph={<Glyph name="mix" />} onPress={() => pick({ kind: "all" }, "thread")} />
        <SideRow id="calendar" title="Calendar" selected={state.main === "calendar"} glyph={<Glyph name="cal" />}
          onPress={() => { dispatch({ type: "calendar" }); data.nav.openCalendar(); }} />
        {sections}
        <SectionHead id="lists" label="Lists" closed={closed("lists")} onToggle={() => dispatch({ type: "section", key: "lists" })} />
        {closed("lists") ? null : [
          list("follow", "Following", "bell", (r) => r.followed),
          list("camp", "Campaigns", "flag", (r) => r.campaignId !== undefined),
        ]}
        {calendars.length > 0 ? <SectionHead id="cals" label="Calendars" closed={closed("cals")} onToggle={() => dispatch({ type: "section", key: "cals" })} /> : null}
        {closed("cals") ? null : calendarRows}
      </ScrollView>
      <View style={styles.foot}>
        <Pressable accessibilityRole="button" accessibilityLabel="Open the dialer" testID="inbox-dialer" onPress={() => data.nav.openDialer()} style={({ hovered }: { hovered?: boolean }) => [styles.dialer, hovered === true && styles.dialerOver]}>
          <Glyph name="call" size={14} />
          <Text style={styles.dialerText}>Dialer</Text>
          <View style={styles.grow} />
          <Text style={styles.keys}>{"⌘⇧K"}</Text>
        </Pressable>
      </View>
      {menu.element}
    </View>
  );
}

export function InboxSidebar(): ReactElement {
  const data = useOptionalInboxData();
  if (!data) return <SidebarLoading />;
  return <Sidebar />;
}

const styles = StyleSheet.create({
  side: { flex: 1, minWidth: 220, backgroundColor: "var(--side)" as string, borderRightWidth: 1, borderRightColor: "var(--line)" as string },
  top: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 8, paddingTop: 10, paddingBottom: 4, height: 44 },
  grow: { flex: 1 },
  search: { flexDirection: "row", alignItems: "center", gap: 7, height: 30, marginHorizontal: 10, marginBottom: 8, paddingHorizontal: 9, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  searchOn: { boxShadow: "0 0 0 1px var(--accent-line)" as string },
  input: { flex: 1, minWidth: 0, padding: 0, fontSize: 13, color: "var(--ink)" as string, outlineStyle: "none" as "none" },
  scroll: { flex: 1 },
  scrollIn: { paddingHorizontal: 6, paddingBottom: 12 },
  glyph: { width: 20, alignItems: "center", justifyContent: "center", marginRight: 6 },
  trail: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 9, height: 9, borderRadius: 9 },
  sec: { flexDirection: "row", alignItems: "center", gap: 5, height: 26, marginTop: 10, paddingHorizontal: 8, borderRadius: 6 },
  secOver: { backgroundColor: "var(--hover)" as string },
  secText: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  chevShut: { transform: [{ rotate: "-90deg" }] },
  foot: { paddingHorizontal: 8, paddingTop: 6, paddingBottom: 10, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  dialer: { flexDirection: "row", alignItems: "center", gap: 8, height: 28, paddingHorizontal: 8, borderRadius: 6 },
  dialerOver: { backgroundColor: "var(--hover)" as string },
  dialerText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  keys: { fontSize: 11.5, color: "var(--ink-4)" as string },
  skRow: { flexDirection: "row", alignItems: "center", gap: 10, height: 28, paddingHorizontal: 14 },
  skDot: { width: 14, height: 14, borderRadius: 4, backgroundColor: "var(--hover)" as string },
  skBar: { height: 9, borderRadius: 5, backgroundColor: "var(--hover)" as string },
});
