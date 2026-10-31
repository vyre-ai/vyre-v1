// Inbox in the shell (spec 3.3): the sidebar (inboxes, numbers, channels, calendars) on the left; in the middle the contact list, a contact's conversation once one is opened, or the
// Calendar when the sidebar asks for it. The Inbox's own UI state (view, scope, filters, selection) is one reducer shared by the sidebar and the list. Before the Space's runtime
// exists the place draws its loading frame.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useOpenedId, usePlaceHash } from "../hash/context.tsx";
import { NotFound } from "../hash/NotFound.tsx";
import { useMissing } from "../hash/useMissing.ts";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { PhoneDeviceLike } from "../../../../../ui/src/Softphone/index.tsx";
import { Calendar } from "../../places/inbox/calendar/Calendar.tsx";
import { ContactList, ListLoading } from "../../places/inbox/contactlist/ContactList.tsx";
import { CallConversation } from "../../places/inbox/callpane/index.ts";
import type { OpenTask } from "../../places/inbox/callpane/index.ts";
import { InboxUnmatched } from "../../places/inbox/unmatched/index.ts";
import { InboxDataProvider } from "../../places/inbox/sidebar/data.tsx";
import type { InboxData } from "../../places/inbox/sidebar/data.tsx";
import { InboxSidebar, SidebarLoading } from "../../places/inbox/sidebar/InboxSidebar.tsx";
import { InboxStateProvider, useInboxState } from "../../places/inbox/sidebar/state.tsx";
import { MobileBackContext } from "../../mobile/shell/back.ts";
import { InboxPhoneDock } from "../../places/inbox/softphone/phone.tsx";
import { CallTitlePill } from "../../places/inbox/softphone/pill.tsx";
import { inboxData } from "./inbox-data.ts";
import { capLive } from "./records-live.ts";
import { useOptionalShellRuntime } from "./runtime.tsx";
import type { ShellRuntime } from "./runtime.tsx";

export { inboxData } from "./inbox-data.ts";

/** The optional global phone shares Inbox's already-lazy production chunk. */
export function InboxPhoneShell({ device, data, children }: { device: PhoneDeviceLike; data: InboxData; children: ReactNode }): ReactElement {
  return <InboxDataProvider value={data}><InboxPhoneDock device={device}>{children}</InboxPhoneDock></InboxDataProvider>;
}

export { CallTitlePill as InboxCallTitlePill };

export const SIDEBAR_W = 264;

export function InboxLoading(): ReactElement {
  return (
    <View testID="inbox-place-loading" accessibilityLabel="Loading" style={st.row}>
      <View style={st.side}><SidebarLoading /></View>
      <View style={st.main}><ListLoading /></View>
    </View>
  );
}

/** The people the Calendar can shade as busy and add to an event: the Space's people. calendar.availability takes a member id where it takes an address, so the id is what the menu keys on. */
export function calendarTeam(people: readonly { id: string; name: string; kind: string }[]): { email: string; name: string }[] {
  return people.filter((p) => p.kind === "person").map((p) => ({ email: p.id, name: p.name }));
}

/** The person's open tasks for the Call tab ("Open tasks"). */
function useOpenTasks(rt: ShellRuntime): readonly OpenTask[] {
  const q = useMemo(() => capLive<{ tasks: Array<{ title: string; due?: number }> }>(rt, "tasks.list", { scope: "mine", states: ["todo", "doing"], limit: 5 }), [rt]);
  const s = useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
  return useMemo(() => (s.status === "ready" ? s.data.tasks.map((t) => ({ title: t.title, ...(t.due ? { due: new Date(t.due).toLocaleDateString(undefined, { weekday: "short" }) } : {}) })) : []), [s]);
}

function Main({ rt, openId, close }: { rt: ShellRuntime; openId: string | null; close: () => void }): ReactElement {
  const missing = useMissing(rt.screens, "inbox.contact-tab", "thread", openId ? { conversationId: openId } : null);
  const { state, dispatch } = useInboxState();
  const { target, opened } = usePlaceHash();
  const people = useSyncExternalStore(rt.principals.subscribe, rt.principals.getSnapshot, rt.principals.getSnapshot);
  const team = useMemo(() => calendarTeam(people.status === "ready" ? people.data : []), [people]);
  const tasks = useOpenTasks(rt);
  // Choosing another inbox, view, filter or the Calendar in the sidebar leaves the open conversation and shows the list again.
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } close(); if (target.screen === "inbox.unmatched") opened({}); }, [state.scope, state.view, state.main, state.channels, state.inboxes, state.needsMatch]); // eslint-disable-line react-hooks/exhaustive-deps -- close and the hash are read when the sidebar changes, not the other way round
  if (state.main === "calendar") return <Calendar me={rt.me.id} team={team} />;
  // Match to a record (the list's menu and its row) opens the Unmatched screen: every sender or caller with no record, and the Match menu on each
  if (target.screen === "inbox.unmatched" && !openId) {
    return (
      <InboxUnmatched
        onShowAll={() => { dispatch({ type: "showAll" }); opened({}); }}
        onSearchRecords={(who) => rt.open({ screen: "shell.cmdk", args: { q: who.displayName || who.address } })}
      />
    );
  }
  if (openId && missing) return <NotFound what="conversation" />;
  // the conversation with the call bar and, after a call, the ended strip when the phone is on this contact
  if (openId) return <CallConversation key={openId} conversationId={openId} tasks={tasks} onOpenRecord={(contactId, recordId) => rt.open({ subject: { type: "record", id: recordId ?? contactId } })} onAsk={(contactId) => rt.open({ screen: "chats.conversation", args: { with: "assistant", ...(contactId ? { contactId } : {}) } })} />;
  return <ContactList />;
}

/** The sidebar and the middle side by side; on a phone one at a time: the list of inboxes first, then what a row opened, with a way back. */
function InboxFrame({ rt, openId, close }: { rt: ShellRuntime; openId: string | null; close: () => void }): ReactElement {
  const winW = useWindowDimensions().width;
  const phone = winW > 0 && winW < 720;
  const { state } = useInboxState();
  const [entered, setEntered] = useState(false);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } setEntered(true); }, [state.scope, state.view, state.main]);
  if (!phone) {
    return (
      <View testID="inbox-place" style={st.row}>
        <View style={st.side}><InboxSidebar /></View>
        <View style={st.main}><Main rt={rt} openId={openId} close={close} /></View>
      </View>
    );
  }
  const inMain = entered || (openId !== null && openId !== "");
  return (
    <View testID="inbox-place" style={st.row}>
      {inMain ? (
        <View style={st.main}>
          {/* an open conversation carries the Back in its own contact header (one header); the list behind a view keeps the chip */}
          {openId ? null : <Pressable accessibilityRole="button" testID="phone-back-to-inboxes" onPress={() => { setEntered(false); close(); }} style={st.backChip}><Text style={st.backText}>{"\u2039 Inbox"}</Text></Pressable>}
          <MobileBackContext.Provider value={openId ? () => { setEntered(false); close(); } : null}><Main rt={rt} openId={openId} close={close} /></MobileBackContext.Provider>
        </View>
      ) : <View style={st.main}><InboxSidebar /></View>}
    </View>
  );
}

function InboxView({ rt }: { rt: ShellRuntime }): ReactElement {
  const { opened } = usePlaceHash();
  const hashed = useOpenedId(["conversation", "call"], ["conversationId"]);
  const [picked, setOpenId] = useState<string | null>(null);
  const openId = picked ?? hashed;
  const data = useMemo(() => inboxData(rt, (id) => { setOpenId(id); opened({ subject: { type: "conversation", id } }); }), [rt, opened]);
  return (
    <InboxDataProvider value={data}>
      <InboxStateProvider>
        <InboxFrame rt={rt} openId={openId} close={() => setOpenId("")} />
      </InboxStateProvider>
    </InboxDataProvider>
  );
}

export default function InboxPlace(): ReactElement {
  const rt = useOptionalShellRuntime();
  return rt ? <InboxView rt={rt} /> : <InboxLoading />;
}

const st = StyleSheet.create({
  row: { flex: 1, flexDirection: "row", minHeight: 0, backgroundColor: "var(--win)" as string },
  side: { width: SIDEBAR_W, minHeight: 0 },
  main: { flex: 1, minWidth: 0, minHeight: 0 },
  backChip: { alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 10 },
  backText: { fontSize: 14, color: "var(--accent)" as string },
});
