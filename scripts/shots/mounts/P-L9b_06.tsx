// Mount for P-L9b_06: Needs you (the default) or the helper chat (?screen=helper), over the Northwind sample Space. Needs you takes ?v=harbor for Harbor Studio (nothing waiting)
// and ?sel=n1 to open a request (n1 approve with a table, n2 review with an excerpt, n3 blocked on a login, n6 a problem report, n7 blocked on a sign-in). The helper chat takes
// ?v=running for a helper that is still working. Every control works against the sample replica: Approve and Send back leave the list, Snooze and Take change it, Stop closes
// the helper. All rows are drawn (no scroll window) so a screenshot shows the whole list. A window narrower than 640 px shows one column at a time.
import { useMemo } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { HelperChat } from "../../../apps/app/src/places/chats/helper/HelperChat.tsx";
import { createSample as createHelperSample } from "../../../apps/app/src/places/chats/helper/sample.ts";
import { NeedsYou } from "../../../apps/app/src/places/chats/needsyou/NeedsYou.tsx";
import { createSample as createNeedsSample } from "../../../apps/app/src/places/chats/needsyou/sample.ts";

export const title = "Needs you and the helper chat";

export default function Mount(): ReactNode {
  const params = useMemo(() => new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const helper = params.get("screen") === "helper";
  const v = params.get("v");
  const sel = params.get("sel") ?? undefined;
  const needs = useMemo(() => createNeedsSample(v === "harbor" ? "harbor" : "northwind"), [v]);
  const helperSample = useMemo(() => createHelperSample(v === "running" ? "running" : "done"), [v]);
  return (
    <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}>
      {helper ? <HelperChat data={helperSample.data} /> : <NeedsYou data={needs.data} window={{ start: 0, end: 500 }} {...(sel ? { initialSelected: sel } : {})} />}
    </View>
  );
}
