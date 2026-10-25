// Mount for P-L9c_01b (the Starred list and the filter menu with its count column): the same Inbox as P-L9c_01, with ?scope=starred.
// Mount for P-L9c_01: the Inbox sidebar and contact list over the Northwind sample Space (or Harbor Studio with ?space=harbor).
// ?view=contact|thread|calls  ?scope=follow|camp|mbx_support  ?channels=email,sms  ?needs=1  ?rows=10000 (the long list the scroll probe runs over)
// ?menu=filter|view opens that header menu on load. On a phone width the sidebar is a drawer, so only the list shows. Every control works against the sample replica.
import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { ContactList } from "../../../apps/app/src/places/inbox/contactlist/index.ts";
import { createSampleInbox, harbor, northwind } from "../../../apps/app/src/places/inbox/contactlist/sample.ts";
import { InboxDataProvider, InboxSidebar, InboxStateProvider } from "../../../apps/app/src/places/inbox/sidebar/index.ts";
import type { Channel, InboxState, Scope, View as ViewKind } from "../../../apps/app/src/places/inbox/sidebar/index.ts";

export const title = "Inbox";

const VIEWS: readonly ViewKind[] = ["contact", "thread", "calls"];
const CHANNELS: readonly Channel[] = ["email", "sms", "call"];

function scopeOf(v: string | null): Scope {
  if (v === "starred") return { kind: "starred" };
  if (v === "follow") return { kind: "follow" };
  if (v === "camp") return { kind: "camp" };
  if (v) return { kind: "mailbox", id: v };
  return { kind: "all" };
}

export default function Mount(): ReactNode {
  const q = useMemo(() => new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const bulk = Math.min(20000, Number(q.get("rows") ?? 0) || 0);
  const space = q.get("space") === "harbor" ? harbor : northwind;
  const sample = useMemo(() => createSampleInbox(space, { bulk }), [space, bulk]);
  const initial = useMemo<Partial<InboxState>>(() => {
    const view = VIEWS.find((x) => x === q.get("view"));
    const channels = (q.get("channels") ?? "").split(",").filter((c): c is Channel => (CHANNELS as readonly string[]).includes(c));
    return { ...(view ? { view } : {}), scope: scopeOf(q.get("scope")), channels, needsMatch: q.get("needs") === "1" };
  }, [q]);
  const width = useWindowDimensions().width;
  const phone = width > 0 && width < 720; // 0 is "not measured yet" (the static page)
  useEffect(() => {
    const menu = q.get("menu");
    if (menu !== "filter" && menu !== "view") return;
    const g = globalThis as { document?: { querySelector(s: string): { click?: () => void } | null } };
    const t = setTimeout(() => g.document?.querySelector(`[data-testid="inbox-${menu}"]`)?.click?.(), 400);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <InboxDataProvider value={sample.data}>
      <InboxStateProvider initial={initial}>
        <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
          {phone ? null : <View style={{ width: 240 }}><InboxSidebar /></View>}
          <ContactList />
        </View>
      </InboxStateProvider>
    </InboxDataProvider>
  );
}
