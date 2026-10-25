// Mount for P-L9b_09: the Chats right pane at its default 340 px (the tab strip folds what does not fit behind More), a routine open on it (?routine=r3), and the computer popup while
// you are in control (?popup=takeover, the hand stays on the Take over icon). ?tab= picks the pane's section. Everything works against the sample replicas.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { ChatRightPane } from "../../../apps/app/src/places/chats/rightpane/ChatRightPane.tsx";
import { DEFAULT_TAB, isTabKey } from "../../../apps/app/src/places/chats/rightpane/model.ts";
import { createSample } from "../../../apps/app/src/places/chats/rightpane/sample.ts";
import { ComputerPopup } from "../../../apps/app/src/places/chats/computer/ComputerPopup.tsx";
import { createSample as createPopupSample } from "../../../apps/app/src/places/chats/computer/sample.ts";

export const title = "Chats right pane polish";

export default function Mount(): ReactNode {
  // The query is read after mount: the static export renders the first frame without it, and the client must render that same frame or React leaves the exported markup behind.
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const params = useMemo(() => new URLSearchParams(search ?? ""), [search]);
  const sample = useMemo(() => createSample("northwind"), []);
  const popup = useMemo(() => createPopupSample("takeover"), []);
  const [open, setOpen] = useState(true);
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  if (params.get("popup") === "takeover") return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}><ComputerPopup data={popup.data} /></View>;
  const tabParam = params.get("tab") ?? "";
  const routine = params.get("routine");
  return (
    <View style={{ flex: 1, flexDirection: "row", justifyContent: "flex-end", backgroundColor: "var(--win)" as string }}>
      <ChatRightPane data={sample.data} open={open} onToggle={() => setOpen((o) => !o)} initialTab={isTabKey(tabParam) ? tabParam : DEFAULT_TAB} window={{ start: 0, end: 500 }} {...(routine ? { openRoutine: routine } : {})} />
    </View>
  );
}
