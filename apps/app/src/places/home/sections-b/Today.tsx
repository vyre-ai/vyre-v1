// Home > Today: your calendar day, one line per event (spec 3.1). The running event is marked Now, the next one is marked Next, past ones are quiet.
// Click or Enter opens the event; Join opens the call link. Data: calendar.list_events for the person's day (screen home.today-starred-ask, query "events"), live from the kept copy.
// A Personal Space draws this section only when a calendar is connected on this computer: the section needs a connected account.
import { useEffect } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useHomeData, useScreenQuery, useSelection } from "../sections-a/data.tsx";
import { rowKeysBy } from "../sections-a/model.ts";
import { EmptyLine, Section, SectionHeader, Skeleton } from "../sections-a/parts.tsx";
import { isPersonal, useExtras } from "./data.tsx";
import { TODAY_SCREEN, dayWindow, todayCount, todayRows } from "./model.ts";
import { GoButton, ListRow } from "./parts.tsx";

type Out = CapMap["calendar.list_events"]["out"];
export const TODAY_SECTION = 5;

export function Today(): ReactElement | null {
  const data = useHomeData();
  const extras = useExtras();
  const sel = useSelection();
  const menu = useMenu();
  const c = data.clock();
  const win = dayWindow(c);
  const hidden = isPersonal(extras) && !extras.calendarConnected;
  const q = useScreenQuery<Out>(TODAY_SCREEN, "events", { from: win.from, to: win.to });
  const list = q.status === "ready" && !hidden ? todayRows(q.data.events, c) : [];
  const keyList = rowKeysBy("today", list, (r) => r.id).join("|");
  useEffect(() => { sel.register(TODAY_SECTION, keyList && !hidden ? keyList.split("|") : []); }, [keyList, hidden]);
  if (hidden) return null;

  const rows: ReactElement[] = [];
  for (const r of list) {
    const open = (): void => data.nav.openSubject({ type: "event", id: r.id });
    const entries: MenuEntry[] = [{ label: "Open event", icon: "open", onSelect: open }];
    if (r.joinUrl) entries.push({ label: "Join the call", icon: "link", onSelect: () => extras.openUrl(r.joinUrl!) });
    const mark = r.state === "now" ? "Now" : r.state === "next" ? "Next" : null;
    rows.push(
      <ListRow
        key={r.id}
        rowKey={`today:${r.id}`}
        title={r.title}
        note={r.note}
        label={`${r.title}, ${r.when}${mark ? `, ${mark}` : ""}`}
        leading={<View style={[local.when, r.state === "past" && local.past]}><Text numberOfLines={1} style={[local.whenText, r.state === "now" && local.accent]}>{r.when}</Text></View>}
        trailing={
          <>
            {mark ? <Text style={[local.mark, r.state === "now" && local.accent]}>{mark}</Text> : null}
            {r.joinUrl && r.state !== "past" ? <GoButton label="Join" testID={`today-join-${r.id}`} onPress={() => extras.openUrl(r.joinUrl!)} /> : null}
          </>
        }
        onOpen={open}
        onMenu={(x, y) => menu.show(entries, x, y, "context", { label: r.title })}
      />,
    );
  }

  return (
    <Section id="s-today">
      <SectionHeader id="today" title="Today" count={q.status === "ready" ? todayCount(list) : undefined} />
      {q.status === "loading" ? <Skeleton rows={2} id="today" /> : rows.length ? <View accessibilityRole="list">{rows}</View> : <EmptyLine id="today" text="Nothing on your calendar today" />}
      {menu.element}
    </Section>
  );
}

const local = StyleSheet.create({
  when: { width: 72, justifyContent: "center" },
  past: { opacity: 0.55 },
  whenText: { fontSize: 12.5, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  mark: { fontSize: 12, fontWeight: "600", color: "var(--ink-3)" as string },
  accent: { color: "var(--accent)" as string, fontWeight: "600" },
});
