// Mount for P-L9_23: the two screens the real shell now opens. ?part=cmdk is the Cmd-K sheet as it opens (empty query, Recent); ?part=newtab is the new-tab page (the same search inline).
// Both draw the shared CmdK components over the Northwind sample Space, the same data shape the real SessionGate builds in cmdk/gate.ts.
import type { ReactNode } from "react";
import { View } from "react-native";
import { CmdK, NewTabSearch } from "../../../apps/app/src/shell/cmdk/index.ts";
import { createSampleData } from "../../../apps/app/src/shell/cmdk/sample.ts";

export const title = "Cmd-K and new tab";

const data = createSampleData({ serverDelayMs: 30 }).data;

export default function Mount(): ReactNode {
  const part = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "cmdk";
  return (
    <View style={{ flex: 1, backgroundColor: "var(--win)" }}>
      {part === "newtab" ? <View style={{ flex: 1, paddingTop: 96 }}><NewTabSearch data={data} /></View> : <CmdK data={data} />}
    </View>
  );
}
