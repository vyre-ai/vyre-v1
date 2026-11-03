// Mount for MEETINGS_01: Inbox > Meetings over the Northwind sample (invented people). The sidebar's Meetings row says one meeting is ready to close. ?view=list shows the tab: the renewal call
// ready to close, a weekly sync with nothing to do, a closed kickoff and one still being prepared. ?view=package opens the renewal call: the summary, the decision and the open question, two
// tasks (one already created, with its link), Pat's record update with the field change and the meeting note, the follow-up email and the next-meeting hold (skipped, with Undo). Writes answer
// nothing here, so the screen stays as drawn. ?at=email scrolls down to the email and the hold. On a phone the tab fills the screen with no sidebar.
import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { SAMPLE_NOW, createSampleInbox, northwind } from "../../../apps/app/src/places/inbox/contactlist/sample.ts";
import { InboxDataProvider, InboxSidebar, InboxStateProvider } from "../../../apps/app/src/places/inbox/sidebar/index.ts";
import type { InboxData } from "../../../apps/app/src/places/inbox/sidebar/index.ts";
import { MeetingsTab } from "../../../apps/app/src/places/inbox/meetings/index.ts";
import type { MeetingPackage, MeetingsListOut } from "../../../apps/app/src/places/inbox/meetings/index.ts";

export const title = "Meetings close themselves";

const SIDEBAR_W = 244;
const HOUR = 3_600_000;
const ME = "usr_irfad";
const SAM = "usr_sam";
const RENEWAL = "rec_renewal1";

const LIST: MeetingsListOut = {
  ready: 1,
  meetings: [
    { meetingId: "rec_intake01", title: "Intake call with Rivera Dental", startsAt: SAMPLE_NOW - 40 * 60_000, endsAt: SAMPLE_NOW - 10 * 60_000, attendees: ["Irfad", "Luz Rivera"], state: "preparing", proposed: 0, done: 0 },
    { meetingId: RENEWAL, title: "Lee Holdings renewal", startsAt: SAMPLE_NOW - 3 * HOUR, endsAt: SAMPLE_NOW - 2 * HOUR, attendees: ["Irfad", "Sam Reyes", "Pat Lee"], state: "ready", proposed: 4, done: 1 },
    { meetingId: "rec_weekly01", title: "Weekly team sync", startsAt: SAMPLE_NOW - 26 * HOUR, endsAt: SAMPLE_NOW - 25 * HOUR, attendees: ["Irfad", "Sam Reyes", "Mia Chen"], state: "nothing", proposed: 0, done: 0 },
    { meetingId: "rec_kickoff1", title: "Harbor Studio kickoff", startsAt: SAMPLE_NOW - 3 * 24 * HOUR, endsAt: SAMPLE_NOW - 3 * 24 * HOUR + HOUR, attendees: ["Irfad", "Ana Ruiz", "Tom Brandt", "Mia Chen", "Sam Reyes"], state: "closed", proposed: 0, done: 6 },
  ],
};

const PKG: MeetingPackage = {
  meetingId: RENEWAL, title: "Lee Holdings renewal", startsAt: SAMPLE_NOW - 3 * HOUR, endsAt: SAMPLE_NOW - 2 * HOUR, state: "ready",
  attendees: [{ name: "Irfad", email: "irfad@northwind.example" }, { name: "Sam Reyes", email: "sam@northwind.example" }, { name: "Pat Lee", email: "pat@leeholdings.example", recordId: "rec_pat" }],
  summary: "Pat confirmed Lee Holdings moves to the annual plan from January, and is now Head of Operations. Sam sends the revised quote and Irfad sets up onboarding with their team. Whether their legal team reviews the terms is still open.",
  decisions: ["Lee Holdings moves to the annual plan, starting in January."],
  questions: ["Does the Lee Holdings legal team need to review the terms?"],
  items: [
    { itemId: "mci_t1", kind: "task", status: "proposed", title: "Send Pat the revised quote", assignee: SAM, ownerName: "Sam", due: SAMPLE_NOW + 3 * 24 * HOUR, why: "Sam offered on the call." },
    { itemId: "mci_t2", kind: "task", status: "approved", title: "Set up the onboarding call with the Lee Holdings team", assignee: ME, made: [{ type: "task", id: "tsk_onb", title: "Set up the onboarding call" }] },
    { itemId: "mci_r1", kind: "record", status: "proposed", title: "Pat Lee", recordId: "rec_pat", recordType: "contact", changes: [{ field: "title", title: "Job title", from: "Operations lead", to: "Head of Operations" }], note: "Renewal call: moving to the annual plan from January; their legal review is still open." },
    { itemId: "mci_r2", kind: "record", status: "proposed", title: "Lee Holdings", recordId: "rec_lee", recordType: "company", changes: [{ field: "website", title: "Website", to: "https://leeholdings.example" }], note: "Renewal agreed in principle: annual plan from January." },
    {
      itemId: "mci_e1", kind: "email", status: "proposed", title: "Next steps on your renewal", subject: "Next steps on your renewal", send: "send", to: [{ address: "pat@leeholdings.example", name: "Pat Lee" }],
      text: "Hi Pat,\n\nThanks for the time today. To confirm: you are moving to the annual plan from January. Sam will send the revised quote by Thursday, and I will set up the onboarding call with your team. We still need to know whether your legal team wants to review the terms.\n\nTalk next week,\nIrfad",
    },
    { itemId: "mci_h1", kind: "hold", status: "skipped", title: "Renewal: legal review", startsAt: SAMPLE_NOW + 7 * 24 * HOUR + 4 * HOUR, endsAt: SAMPLE_NOW + 7 * 24 * HOUR + 4.5 * HOUR },
  ],
  taskId: "tsk_prep", shared: [],
};

const NAMES: Record<string, string> = { [ME]: "Irfad Imtiaz", [SAM]: "Sam Reyes" };

export default function Mount(): ReactNode {
  const q = useMemo(() => new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const width = useWindowDimensions().width;
  const phone = width > 0 && width < 720;
  const sample = useMemo(() => {
    const s = createSampleInbox(northwind);
    s.replica.resolve("meetings.closeout.list", () => LIST);
    s.replica.resolve("meetings.closeout.get", () => PKG);
    return s;
  }, []);
  const data = useMemo<InboxData>(() => ({ ...sample.data, me: ME, call: (cap, input) => (cap.startsWith("meetings.") ? Promise.resolve({}) : sample.data.call(cap, input)) }), [sample]);
  const openId = q.get("view") === "package" ? RENEWAL : null;
  // ?at=email scrolls the package down to the follow-up email and the hold
  useEffect(() => {
    if (q.get("at") !== "email") return;
    const t = setTimeout(() => (globalThis as { document?: { querySelector(s: string): { scrollIntoView(o?: unknown): void } | null } }).document?.querySelector("[data-testid='section-email']")?.scrollIntoView({ block: "start" }), 300);
    return () => clearTimeout(t);
  }, [q]);
  const tab = (
    <MeetingsTab
      openId={openId} onOpen={() => undefined} onBack={() => undefined} nameOf={(id) => NAMES[id] ?? "Someone"} team={[{ id: ME, name: "Irfad Imtiaz" }, { id: SAM, name: "Sam Reyes" }]}
      nav={{ openSubject: () => undefined, openContact: () => undefined, openCalendar: () => undefined }}
    />
  );
  return (
    <InboxDataProvider value={data}>
      <InboxStateProvider initial={{ main: "meetings" }}>
        {phone ? <View style={{ flex: 1, minHeight: 0 }}>{tab}</View> : (
          <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
            <View style={{ width: SIDEBAR_W }}><InboxSidebar /></View>
            <View style={{ flex: 1, minWidth: 0 }}>{tab}</View>
          </View>
        )}
      </InboxStateProvider>
    </InboxDataProvider>
  );
}
