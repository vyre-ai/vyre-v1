// Mount for P-L9b_07: the Chats right pane open beside the (empty) conversation column, over the Northwind sample Space where Intake is working on its computer.
// ?tab=computer (default), threads, files, memory or routines picks the section; ?v=asleep shows Intake asleep, ?v=personal the Personal Space (the assistant, no computer).
// Every control works against the sample replica: wake, take over, sign out, accept and reject, correct, pause and resume, rename and delete with Undo. All rows are drawn
// (no scroll window) so a screenshot shows the whole list. A window narrower than 640 px shows the pane as a screen of its own.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { ChatRightPane } from "../../../apps/app/src/places/chats/rightpane/ChatRightPane.tsx";
import { DEFAULT_TAB, isTabKey } from "../../../apps/app/src/places/chats/rightpane/model.ts";
import { createSample } from "../../../apps/app/src/places/chats/rightpane/sample.ts";
import type { Variant } from "../../../apps/app/src/places/chats/rightpane/sample.ts";

export const title = "Chats right pane";

export default function Mount(): ReactNode {
  // The query is read after mount: the static export renders the first frame without it, and the client must render that same frame or React leaves the exported markup behind.
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const params = useMemo(() => new URLSearchParams(search ?? ""), [search]);
  const variant: Variant = params.get("v") === "asleep" ? "asleep" : params.get("v") === "personal" ? "personal" : "northwind";
  const tabParam = params.get("tab") ?? "";
  const sample = useMemo(() => createSample(variant), [variant]);
  const [open, setOpen] = useState(true);
  const wide = useWindowDimensions().width >= 640;
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: "var(--win)" as string }}>
      {wide ? <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "var(--ink-4)" as string, fontSize: 13 }}>The conversation lands with P-L9b_04</Text></View> : null}
      <ChatRightPane data={sample.data} open={open} onToggle={() => setOpen((o) => !o)} initialTab={isTabKey(tabParam) ? tabParam : DEFAULT_TAB} window={{ start: 0, end: 500 }} />
    </View>
  );
}
