// Mount for CALWEEK_01 (lane l-calendar): Inbox > Calendar, the polished week, day and month over the crowded Northwind sample week (overlaps at 10:00, Block and Focus bands, repeated and multi-day all-day items).
// ?view=week|day|month, ?day=<days from today> (day view). The query and the phone width are read after hydration. On a phone the day view is the default.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { Calendar, ME, TEAM, createCalendarSample } from "../../../apps/app/src/places/inbox/calendar/index.ts";
import type { Mode } from "../../../apps/app/src/places/inbox/calendar/model.ts";
import { DAY, startOfDay } from "../../../apps/app/src/places/inbox/calendar/model.ts";
import { SAMPLE_NOW } from "../../../apps/app/src/places/inbox/contactlist/sample.ts";
import { weeksTo } from "../../../apps/app/src/places/inbox/calendar/sample.ts";
import { InboxDataProvider, InboxSidebar, InboxStateProvider } from "../../../apps/app/src/places/inbox/sidebar/index.ts";
import type { InboxData } from "../../../apps/app/src/places/inbox/sidebar/index.ts";

export const title = "Calendar week, day and month";

const SIDEBAR_W = 244;
// the sample moves by whole weeks to the week it is shot in, so the shots show the current week (the title says so)
const SHIFT = weeksTo(Date.now()) * 7 * DAY;
const TODAY = startOfDay(SAMPLE_NOW + SHIFT, 0);

export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  const width = useWindowDimensions().width;
  const sample = useMemo(() => createCalendarSample(undefined, { shiftWeeks: weeksTo(Date.now()) }), []);
  const data = useMemo<InboxData>(() => ({ ...sample.data, call: (cap, input) => sample.data.call(cap, input).catch(() => ({})) }), [sample]);
  if (!q) return <View style={{ flex: 1 }} />;
  const phone = width > 0 && width < 720;
  const mode = (q.get("view") ?? (phone ? "day" : "week")) as Mode;
  const day = TODAY + Number(q.get("day") ?? 0) * DAY;
  const cal = <Calendar me={ME} team={TEAM} initial={{ mode, day }} onJoin={() => undefined} onOpenUrl={() => undefined} onAsk={() => undefined} onOpenMeeting={() => undefined} onOpenFile={() => undefined} />;
  return (
    <InboxDataProvider value={data}>
      <InboxStateProvider initial={{ main: "calendar" }}>
        {phone ? <View style={{ flex: 1, minHeight: 0 }}>{cal}</View> : (
          <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
            <View style={{ width: SIDEBAR_W }}><InboxSidebar /></View>
            <View style={{ flex: 1, minWidth: 0 }}>{cal}</View>
          </View>
        )}
      </InboxStateProvider>
    </InboxDataProvider>
  );
}
