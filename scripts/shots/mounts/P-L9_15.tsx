// Mount for P-L9_15: the Cmd-K sheet over the Northwind sample Space, typed with "referral" so local and server hits are merged
// (the prototype opens its palette with the same word at #search). ?q= changes the query, ?space=harbor is not needed: one Space.
import type { ReactNode } from "react";
import { View } from "react-native";
import { CmdK } from "../../../apps/app/src/shell/cmdk/index.ts";
import { createSampleData } from "../../../apps/app/src/shell/cmdk/sample.ts";

export const title = "Cmd-K";

const data = createSampleData({ serverDelayMs: 30 }).data;

export default function Mount(): ReactNode {
  const q = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("q") ?? "referral";
  return <View style={{ flex: 1, backgroundColor: "var(--win)" }}><CmdK data={data} initialQuery={q} /></View>;
}
