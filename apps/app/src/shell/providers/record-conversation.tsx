// A contact's Conversation tab on the record page: the Inbox's own tab, so there is one composer and one call control. Whoever can open the record reads the history; what they can send from is theirs (inbox.send_options).
import { useMemo } from "react";
import type { ReactElement } from "react";
import { ContactTab } from "../../places/inbox/contacttab/ContactTab.tsx";
import { InboxDataProvider } from "../../places/inbox/sidebar/data.tsx";
import { inboxData } from "./inbox-data.ts";
import type { AskContact } from "../../places/records/recordpage/askfor.ts";
import type { ShellRuntime } from "./runtime.tsx";

export default function RecordConversation({ rt, person }: { rt: ShellRuntime; person: AskContact }): ReactElement {
  const who = { contactId: person.contactId, name: person.name, ...(person.email ? { email: { to: person.email } } : {}), ...(person.phone ? { phone: { to: person.phone } } : {}) };
  const data = useMemo(() => inboxData(rt, (id) => rt.open({ subject: { type: "conversation", id } })), [rt]);
  return <InboxDataProvider value={data}><ContactTab conversationId="" contactId={person.contactId} person={who} /></InboxDataProvider>;
}
