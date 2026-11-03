// Mount for CALEVENTS_01 (lane l-calevents): Inbox > Calendar with an event open in the pane, over the Northwind sample (invented people). ?open=<event> opens it: e_lease_call is a
// call still to come that Maya organised (Join, Going?, Edit, Prepare, Ask, the guests and their answers, the description's link); e_planning has the Assistant's prep notes;
// e_intake ended three days ago (its close-out with Open close-out, the recording and the transcript). ?edit=1 opens it in edit (standup_3 repeats: Save asks This Event or All Events).
// The query string and the phone width are read after the page has hydrated, so the static HTML and the first client render match. On a phone the event opens as a sheet.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { Calendar, ME, TEAM, createCalendarSample } from "../../../apps/app/src/places/inbox/calendar/index.ts";
import { DAY, startOfDay } from "../../../apps/app/src/places/inbox/calendar/model.ts";
import { SAMPLE_NOW } from "../../../apps/app/src/places/inbox/contactlist/sample.ts";
import { InboxDataProvider, InboxSidebar, InboxStateProvider } from "../../../apps/app/src/places/inbox/sidebar/index.ts";
import type { InboxData } from "../../../apps/app/src/places/inbox/sidebar/index.ts";

export const title = "Calendar event pane";

const SIDEBAR_W = 244;
const TODAY = startOfDay(SAMPLE_NOW, 0);

export default function Mount(): ReactNode {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  const width = useWindowDimensions().width;
  const sample = useMemo(() => createCalendarSample(), []);
  // a press that leaves the page (Join, a link) or a capability this sample does not keep answers quietly, so the screen stays as drawn
  const data = useMemo<InboxData>(() => ({ ...sample.data, call: (cap, input) => sample.data.call(cap, input).catch(() => ({})) }), [sample]);
  if (!q) return <View style={{ flex: 1 }} />;
  const phone = width > 0 && width < 720;
  const open = q.get("open") ?? "e_lease_call";
  const day = open === "e_intake" ? TODAY - 3 * DAY : open.startsWith("standup_") ? TODAY + 3 * DAY : TODAY;
  const cal = <Calendar me={ME} team={TEAM} initial={{ day, openId: open, edit: q.get("edit") === "1" }} onJoin={() => undefined} onOpenUrl={() => undefined} onAsk={() => undefined} onOpenMeeting={() => undefined} onOpenFile={() => undefined} />;
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
