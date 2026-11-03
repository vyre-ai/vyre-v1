// Mount for CALROWS_01: Inbox > Calendar with the sidebar's Calendars rows over the Northwind sample. The Google calendar still carries the generic title, so its row is named for the
// owner's account; Consults' last pull failed (the quiet "Couldn't sync, Retry" line); Mia's calendar was just connected and its first pull has not landed ("Syncing..."). The others
// synced a few minutes ago (their hover and the top of their menu say so). The sidebar is the shell's default width. ?hidden=cal_ms starts with Consults hidden (its dot hollow).
// Sync now never answers here, so the "Syncing..." line stays on screen for the shot; a colour pick repaints the calendar.
import { useMemo } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Calendar, ME, TEAM, createCalendarSample } from "../../../apps/app/src/places/inbox/calendar/index.ts";
import { northwind } from "../../../apps/app/src/places/inbox/contactlist/sample.ts";
import { SAMPLE_NOW } from "../../../apps/app/src/places/inbox/contactlist/sample.ts";
import type { SampleSpace } from "../../../apps/app/src/places/inbox/contactlist/sample.ts";
import { InboxDataProvider, InboxSidebar, InboxStateProvider } from "../../../apps/app/src/places/inbox/sidebar/index.ts";
import type { InboxData } from "../../../apps/app/src/places/inbox/sidebar/index.ts";
import type { Row } from "../../../client/src/index.ts";

export const title = "Calendars rows";

/** The shell's default place-sidebar width (SIDEBAR_DEFAULT in shell/sidebar/SidebarSlot.tsx). */
const SIDEBAR_W = 244;

const SPACE: SampleSpace = {
  ...northwind,
  mailboxes: northwind.mailboxes.map((m) => (m.id === "mbx_work" ? { ...m, ownerId: "usr_irfad" } : m)),
  calendars: [
    ...northwind.calendars.map((c) => (c.id === "cal_work" ? { ...c, title: "Google Calendar", lastSyncAt: SAMPLE_NOW - 2 * 60_000 } : c.id === "cal_ms" ? { ...c, title: "Consults", state: "error" as const, lastSyncAt: SAMPLE_NOW - 3 * 3_600_000 } : { ...c, lastSyncAt: SAMPLE_NOW - 10 * 60_000 })),
    { id: "cal_mia", title: "mia@northwind.example", color: "#16a085", provider: "google", ownerId: "usr_mia", personal: false, state: "syncing" },
  ],
};

export default function Mount(): ReactNode {
  const q = useMemo(() => new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const sample = useMemo(() => createCalendarSample(SPACE), []);
  const data = useMemo<InboxData>(() => ({
    ...sample.data,
    nav: { ...sample.data.nav, openExternal: () => undefined, openCalendarSettings: () => undefined },
    call(cap, input) {
      if (cap === "calendar.sync_now") return new Promise(() => undefined);
      if (cap === "calendar.update_calendar") {
        const i = input as { calendarId: string; color: string };
        const c = SPACE.calendars.find((x) => x.id === i.calendarId);
        if (c) sample.replica.put("calendars", [{ ...c, color: i.color } as unknown as Row]);
        return Promise.resolve({});
      }
      return sample.data.call(cap, input);
    },
  }), [sample]);
  const hidden = (q.get("hidden") ?? "").split(",").filter(Boolean);
  return (
    <InboxDataProvider value={data}>
      <InboxStateProvider initial={{ main: "calendar", hiddenCalendars: hidden }}>
        <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
          <View style={{ width: SIDEBAR_W }}><InboxSidebar /></View>
          <View style={{ flex: 1, minWidth: 0 }}><Calendar me={ME} team={TEAM} /></View>
        </View>
      </InboxStateProvider>
    </InboxDataProvider>
  );
}
