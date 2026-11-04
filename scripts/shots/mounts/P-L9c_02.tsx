// Mount for P-L9c_02: a contact's tab over the Northwind sample Space (or Harbor Studio with ?space=harbor).
// ?c=<conversation id> (default elena)  ?open=eml_<id> opens that thread message  ?open=transcript opens the call's transcript and the lease email's quoted text  ?mail=held makes the next send wait for the Gate
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
    // ?updated=1: the agent drafted again on this thread, so its card says Updated and keeps the earlier text one click away
    if (q.get("updated") === "1") {
      const rows = sample.replica.rows("drafts") as unknown as { id: string; contactId?: string; snippet: string }[];
      sample.replica.put("drafts", rows.map((r) => (r.id === "dr_elena" ? { ...r, snippet: "Hi Elena, the lease documents are ready. Thursday at 2:00 PM Pacific works for the call.", earlier: { at: Date.now() - 3_600_000, subject: "Re: Lease documents for Thursday", text: "Hi Elena, Thursday at 3:00 am Pakistan time works for the call." } } : r)) as never);
    }
    // ?open=eml_<id> opens that message of a thread (a closed one-line message opens on a press)
    const msg = q.get("open");
    if (msg && msg.startsWith("eml_")) {
      const t = setTimeout(() => (globalThis as { document?: { querySelector(s: string): { click?: () => void } | null } }).document?.querySelector(`[data-testid="email:${msg}"]`)?.click?.(), 400);
      return () => clearTimeout(t);
    }
    if (q.get("open") !== "transcript") return;
    // opened parts make the feed taller: stay at the newest end so the agent's draft with Send, Edit and Discard is in view, as it is on opening
    const g = globalThis as { document?: { querySelector(s: string): { click?: () => void } | null } };
    const t = setTimeout(() => {
      const toggles = id === "marcus" ? ["transcript-toggle:mc1"] : ["transcript-toggle:c_elena", "quote-toggle:m_lease"];
      for (const t of toggles) g.document?.querySelector(`[data-testid="${t}"]`)?.click?.();
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
