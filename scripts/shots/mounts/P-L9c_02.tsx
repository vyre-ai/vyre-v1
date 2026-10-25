// Mount for P-L9c_02: a contact's tab over the Northwind sample Space (or Harbor Studio with ?space=harbor).
// ?c=<conversation id> (default elena)  ?open=transcript opens the call's transcript and the lease email's quoted text  ?mail=held makes the next send wait for the Gate
// Every control works against the sample replica; on a phone the tab fills the width, as the prototype's tab does.
import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { ContactTab, createContactTabSample } from "../../../apps/app/src/places/inbox/contacttab/index.ts";
import { harbor, northwind } from "../../../apps/app/src/places/inbox/contactlist/sample.ts";
import { InboxDataProvider } from "../../../apps/app/src/places/inbox/sidebar/index.ts";

export const title = "Inbox contact";

export default function Mount(): ReactNode {
  const q = useMemo(() => new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const space = q.get("space") === "harbor" ? harbor : northwind;
  const sample = useMemo(() => createContactTabSample(space), [space]);
  const id = q.get("c") ?? (space === harbor ? "clara" : "elena");
  const contactId = (sample.replica.rows("contacts") as unknown as { id: string; contactId?: string }[]).find((c) => c.id === id)?.contactId;
  useEffect(() => {
    if (q.get("mail") === "held") sample.mailStatus.next = "held";
    if (q.get("open") !== "transcript") return;
    // opened parts make the feed taller: stay at the newest end so the agent's draft with Send, Edit and Discard is in view, as it is on opening
    const g = globalThis as { document?: { querySelector(s: string): { click?: () => void } | null } };
    const t = setTimeout(() => {
      g.document?.querySelector('[data-testid="transcript-toggle:c_elena"]')?.click?.();
      g.document?.querySelector('[data-testid="quote-toggle:m_lease"]')?.click?.();
      setTimeout(() => {
        const feed = (globalThis as { document?: { querySelector(s: string): { scrollTop: number; scrollHeight: number } | null } }).document?.querySelector('[data-testid="contact-feed"]');
        if (feed) feed.scrollTop = feed.scrollHeight;
      }, 150);
    }, 400);
    return () => clearTimeout(t);
  }, [q, sample]);
  return (
    <InboxDataProvider value={sample.data}>
      <View style={{ flex: 1, minHeight: 0 }}>
        <ContactTab conversationId={id} {...(contactId ? { contactId } : {})} />
      </View>
    </InboxDataProvider>
  );
}
