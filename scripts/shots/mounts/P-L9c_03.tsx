// Mount for P-L9c_03: the Inbox Calendar over the Northwind sample Space (or Harbor Studio with ?space=harbor), with the sidebar beside it.
// ?view=day|week|month  ?people=maya,omar (availability on)  ?new=1 (the new event card open on Monday 27 October at 10:00)  ?hide=cal_ms (a calendar hidden in the sidebar)
// On a phone width the sidebar is a drawer, so only the Calendar shows, in Day.
import { useMemo } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { Calendar, newDraft } from "../../../apps/app/src/places/inbox/calendar/index.ts";
import { ME, TEAM, createCalendarSample } from "../../../apps/app/src/places/inbox/calendar/sample.ts";
import type { Mode } from "../../../apps/app/src/places/inbox/calendar/index.ts";
import { harbor, northwind } from "../../../apps/app/src/places/inbox/contactlist/sample.ts";
import { InboxDataProvider, InboxSidebar, InboxStateProvider } from "../../../apps/app/src/places/inbox/sidebar/index.ts";

export const title = "Inbox calendar";

const MODES: readonly Mode[] = ["day", "week", "month"];
const DAY = 86_400_000;
const FRI = Date.UTC(2025, 9, 24);

export default function Mount(): ReactNode {
  const q = useMemo(() => new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const space = q.get("space") === "harbor" ? harbor : northwind;
  const sample = useMemo(() => createCalendarSample(space), [space]);
  const width = useWindowDimensions().width;
  const phone = width > 0 && width < 720;
  const mode = MODES.find((m) => m === q.get("view"));
  const people = (q.get("people") ?? "").split(",").filter(Boolean).map((p) => `${p}@northwind.example`);
  const mon = FRI + 3 * DAY;
  const draft = q.get("new") === "1" ? newDraft({ startsAt: mon + 10 * 3_600_000, endsAt: mon + 10.5 * 3_600_000 }, "cal_work", people.length ? people : ["maya@northwind.example"]) : undefined;
  const hidden = (q.get("hide") ?? "").split(",").filter(Boolean);
  return (
    <InboxDataProvider value={sample.data}>
      <InboxStateProvider initial={{ main: "calendar", hiddenCalendars: hidden }}>
        <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
          {phone ? null : <View style={{ width: 240 }}><InboxSidebar /></View>}
          <Calendar me={ME} team={TEAM} initial={{ ...(mode ? { mode } : {}), ...(draft ? { day: mon, draft } : {}), ...(people.length ? { people } : {}) }} />
        </View>
      </InboxStateProvider>
    </InboxDataProvider>
  );
}
