// The Calendars section of the Inbox sidebar: one ui/Row per calendar. The dot is the calendar's own colour, filled when the calendar is shown in the view and hollow when it is hidden.
// Click toggles it; right-click and the "..." (on hover or focus) open its ui/Menu; Up and Down move between rows, Space toggles, Enter shows only it. The name takes the row's width:
// the provider's mark and the lock sit at the right end, where the "..." takes their place on hover. Before the first pull lands, while a pull the person started runs, or after the
// last pull failed, a quiet line sits under the row ("Syncing...", "Couldn't sync, Retry"); hovering the row says when it last synced.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { AppIcon } from "../../../../../../ui/src/AppIcon/index.tsx";
import { injectCss } from "../../../../../../ui/src/theme/css.ts";
import { Tooltip } from "../../../../../../ui/src/Tooltip/index.tsx";
import { useInboxData } from "./data.tsx";
import { Glyph, pointOf } from "./parts.tsx";
import { calendarIds } from "./model.ts";
import type { CalendarRow, Mailbox } from "./model.ts";
import { calendarRowKey, calendarRowMenu, calendarName, calendarStatus, calendarColourMenu, providerApp, syncedLabel } from "./calendars.ts";
import { useInboxState } from "./state.tsx";

// the "..." takes the marks' place on hover and on keyboard focus (so the name keeps the width); it is always in the tree, so the keyboard reaches it once the row has focus
let cssDone = false;
function ensureCss(): void {
  if (cssDone) return;
  const d = (globalThis as { document?: Parameters<typeof injectCss>[0] }).document;
  if (!d || !d.head) return;
  injectCss(d, "vyre-inbox-calrow", ".vyre-calrow [data-calmore]{display:none}.vyre-calrow:hover [data-calmore],.vyre-calrow:focus-within [data-calmore]{display:flex}.vyre-calrow:hover [data-calmarks],.vyre-calrow:focus-within [data-calmarks]{display:none}");
  cssDone = true;
}

interface KeyEv { key?: string; target?: unknown; currentTarget?: unknown; preventDefault?: () => void }
interface El { closest?: (s: string) => { querySelectorAll?: (s: string) => ArrayLike<{ focus?: () => void }> } | null }

/** Focus the calendar row at `to` in the same section (web). */
function focusRow(from: unknown, to: number): void {
  const list = (from as El | null)?.closest?.("[data-calrows]")?.querySelectorAll?.("[data-calrow]");
  list?.[to]?.focus?.();
}

export function CalendarRows({ calendars, mailboxes }: { calendars: readonly CalendarRow[]; mailboxes: readonly Mailbox[] }): ReactElement {
  ensureCss();
  const data = useInboxData();
  const { state, dispatch } = useInboxState();
  const menu = useMenu();
  const [running, setRunning] = useState<readonly string[]>([]);
  const [failed, setFailed] = useState<readonly string[]>([]);
  const all = calendarIds(calendars);

  const toggle = (id: string): void => dispatch({ type: "calendarVisible", id });
  const only = (id: string): void => dispatch({ type: "calendarOnly", id, all });
  const syncNow = (id: string): void => {
    if (running.includes(id)) return;
    setRunning((r) => [...r, id]);
    setFailed((f) => f.filter((x) => x !== id));
    void data.call("calendar.sync_now", { calendarId: id })
      .catch(() => setFailed((f) => (f.includes(id) ? f : [...f, id])))
      .finally(() => setRunning((r) => r.filter((x) => x !== id)));
  };
  const colour = (c: CalendarRow, x: number, y: number): void => {
    const swatch = (hex: string): ReactElement => <View testID={`swatch-${hex}`} style={[st.swatch, { backgroundColor: hex }]} />;
    menu.show(calendarColourMenu(c.color, (hex) => { void data.call("calendar.update_calendar", { calendarId: c.id, color: hex }).catch(() => undefined); }, swatch), x, y, "other");
  };
  const open = (c: CalendarRow, name: string, x: number, y: number): void => {
    menu.show(calendarRowMenu(c, name, data.me, {
      only: () => only(c.id),
      colour: () => colour(c, x, y),
      syncNow: () => syncNow(c.id),
      openIn: (url) => data.nav.openExternal?.(url),
      settings: () => (data.nav.openCalendarSettings ? data.nav.openCalendarSettings() : data.nav.connect("gmail")),
    }, data.nav.openExternal !== undefined, syncedLabel(c, data.clock().now)), x, y);
  };

  const rows: ReactElement[] = [];
  calendars.forEach((c, i) => {
    const shown = !state.hiddenCalendars.includes(c.id);
    const name = calendarName(c, mailboxes);
    const app = providerApp(c);
    const status = calendarStatus(c, running.includes(c.id), failed.includes(c.id));
    const synced = syncedLabel(c, data.clock().now);
    const onKeyDown = (e: KeyEv): void => {
      if (e.target !== undefined && e.currentTarget !== undefined && e.target !== e.currentTarget) return;   // a key on the "..." is the button's
      const k = calendarRowKey(e.key ?? "", i, calendars.length);
      if (k === null) return;
      e.preventDefault?.();
      if (k.type === "move") focusRow(e.currentTarget, k.to);
      else if (k.type === "toggle") toggle(c.id);
      else only(c.id);
    };
    rows.push(
      <View key={c.id} {...menuTrigger((x, y) => open(c, name, x, y))} testID={`cal-row-${c.id}`}>
        <Tooltip text={synced}><Row
          id={`nav:cal:${c.id}`}
          title={name}
          leading={
            <View style={st.lead}>
              <View testID={`cal-dot-${c.id}`} accessibilityLabel={shown ? "Shown" : "Hidden"}
                style={[st.dot, { borderColor: c.color }, shown ? { backgroundColor: c.color } : st.hollow]} />
            </View>
          }
          trailing={
            <>
              {app || c.personal ? (
                <View style={st.marks} {...{ dataSet: { calmarks: "1" } }}>
                  {app ? <View testID={`cal-mark-${c.id}`}><AppIcon brand={app.brand} size={14} name={app.name} /></View> : null}
                  {c.personal ? <Glyph name="lock" size={11} /> : null}
                </View>
              ) : null}
              <Pressable accessibilityRole="button" accessibilityLabel={`More for ${name}`} testID={`cal-more-${c.id}`} {...{ dataSet: { calmore: "1" } }}
                onPress={(e) => { (e as { stopPropagation?: () => void }).stopPropagation?.(); const p = pointOf(e); open(c, name, p.x, p.y); }}
                style={(state) => [st.more, (state as { hovered?: boolean }).hovered === true && st.moreOver]}>
                <Glyph name="more" size={14} />
              </Pressable>
            </>
          }
          onPress={() => toggle(c.id)}
          domProps={{ className: "vyre-row vyre-calrow", "data-calrow": c.id, "aria-pressed": shown, onKeyDown }}
        /></Tooltip>
        {status === null ? null : (
          <View style={st.status} testID={`cal-status-${c.id}`}>
            <Text style={[st.statusText, status.kind === "failed" && st.warn]}>{status.text}</Text>
            {status.kind === "failed" ? (
              <>
                <Text style={st.statusText}>{" · "}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Retry syncing ${name}`} testID={`cal-retry-${c.id}`} onPress={() => syncNow(c.id)}>
                  {(state) => <Text style={[st.retry, (state as { hovered?: boolean }).hovered === true && st.retryOver]}>{status.action}</Text>}
                </Pressable>
              </>
            ) : null}
          </View>
        )}
      </View>,
    );
  });

  return (
    <View testID="inbox-calendars" {...{ dataSet: { calrows: "1" } }}>
      {rows}
      {menu.element}
    </View>
  );
}

const st = StyleSheet.create({
  lead: { width: 20, alignItems: "center", justifyContent: "center", marginRight: 6 },
  dot: { width: 10, height: 10, borderRadius: 10, borderWidth: 1.5 },
  hollow: { backgroundColor: "transparent" },
  marks: { flexDirection: "row", alignItems: "center", gap: 4, height: 22 },
  swatch: { width: 12, height: 12, borderRadius: 12 },
  more: { width: 22, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  moreOver: { backgroundColor: "var(--hover)" as string },
  status: { flexDirection: "row", alignItems: "center", paddingLeft: 34, paddingRight: 8, marginTop: -4, marginBottom: 4 },
  statusText: { fontSize: 11.5, lineHeight: 16, color: "var(--ink-3)" as string },
  warn: { color: "var(--warn)" as string },
  retry: { fontSize: 11.5, lineHeight: 16, color: "var(--accent)" as string },
  retryOver: { textDecorationLine: "underline" },
});
