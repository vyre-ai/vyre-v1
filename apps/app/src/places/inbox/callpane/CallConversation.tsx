// Inbox > the conversation with a call in it (prototype Inbox, calllive and callend). The caller's conversation opens with the call bar in its header (face, name, clock, mute, hold, keypad,
// transfer, record, end) and the Call tab of the shared side pane beside it (Notes for this call, Last interactions, Open tasks, Open record). After the call the header holds the ended card
// ("Saved to Elena's conversation", Log a task). The floating dock keeps out of the way while this conversation is open; from another place it is the only call surface.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import { SidePane } from "../../../../../../ui/src/SidePane/index.tsx";
import { CallBar, CallPane, Softphone } from "../../../../../../ui/src/Softphone/index.tsx";
import { ContactTab } from "../contacttab/index.ts";
import type { ContactTabProps, ThreadOut } from "../contacttab/index.ts";
import { useInboxData, useScreenQuery } from "../sidebar/data.tsx";
import { usePhone } from "../softphone/phone.tsx";
import { callIsWith, cardOf, numbersOfThread, showsCall } from "./model.ts";
import type { OpenTask } from "./model.ts";

export interface CallConversationProps extends ContactTabProps {
  /** The person's open tasks, for the Call tab (the app reads them from Tasks). */
  tasks?: readonly OpenTask[];
}

const TAB = [{ key: "call", title: "Call" }] as const;

export function CallConversation({ tasks = [], ...tab }: CallConversationProps): ReactElement {
  const data = useInboxData();
  const phone = usePhone();
  const thread = useScreenQuery<ThreadOut>("inbox.contact-tab", "thread", { conversationId: tab.conversationId, ...(tab.contactId ? { contactId: tab.contactId } : {}) });
  const conv = thread.status === "ready" ? thread.data.conversation : null;
  const key = useMemo(() => (conv ? { id: conv.id, contactId: conv.contactId, address: conv.address } : null), [conv?.id, conv?.contactId, conv?.address]); // eslint-disable-line react-hooks/exhaustive-deps
  const [paneOpen, setPaneOpen] = useState(true);
  // the claim is made once per conversation: the context object changes with the call, the claim function does not need to be re-run for it
  const claim = useRef(phone?.claim);
  claim.current = phone?.claim;
  const has = phone !== null;
  useEffect(() => (key && has ? claim.current?.(key) : undefined), [key, has]);

  const state = phone?.state();
  const view = phone?.view();
  const numbers = thread.status === "ready" ? numbersOfThread(thread.data.items) : [];
  const mine = !!(key && state && view && showsCall(state.phase) && callIsWith(key, state.peer, view.caller?.recordId, numbers));
  // the bar names the person whose conversation this is, even when the dock only knew a number
  const shown = mine && view && conv ? { ...view, caller: { number: view.caller?.number ?? state?.peer ?? "", ...view.caller, name: view.caller?.name ?? conv.displayName, ...(conv.contactId ? { recordId: conv.contactId } : {}) } } : view;
  const clock = data.clock();
  const card = thread.status === "ready" ? cardOf(thread.data.items, tasks, clock.now, clock.offsetMin) : { last: [], tasks };

  return (
    <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }} testID="call-conversation">
      <View style={{ flex: 1, minWidth: 0 }}>
        {mine && shown ? (
          <View testID="call-header" style={{ borderBottomWidth: 1, borderBottomColor: "var(--line)" as string, backgroundColor: "var(--side)" as string }}>
            {shown.mode === "ended" ? <Softphone {...shown} placement="inline" /> : <CallBar {...shown} />}
          </View>
        ) : null}
        <ContactTab {...tab} />
      </View>
      {mine && shown ? (
        <SidePane paneKey="inbox-call" toggle={{ open: paneOpen, onPress: () => setPaneOpen((o) => !o) }} tabs={TAB} activeTab="call" title="Call">
          <CallPane
            caller={shown.caller}
            notes={phone?.notes() ?? ""}
            recording={shown.recording}
            consent={shown.consent}
            card={card}
            onNotes={(t) => phone?.setNotes(t)}
            {...(shown.onOpenRecord ? { onOpenRecord: shown.onOpenRecord } : {})}
          />
        </SidePane>
      ) : null}
    </View>
  );
}
