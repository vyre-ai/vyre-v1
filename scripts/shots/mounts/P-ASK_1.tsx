// Mount for Ask the Space in Cmd-K (owner decision, 3 Nov 2026): the sheet over the Northwind sample Space, driven to one scene by ?scene=
//   typing   the question typed: the Ask the Space row first and highlighted, with the hits it found
//   working  Enter pressed, the answer not back yet
//   done     the answer written, citation chips, the Sources list
//   noaccess the no-access answer
import { useEffect } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { CmdKBody, useCmdK } from "../../../apps/app/src/shell/cmdk/CmdK.tsx";
import { LOCAL_HITS, SAMPLE_ANSWER, SAMPLE_NO_ACCESS, createSampleData } from "../../../apps/app/src/shell/cmdk/sample.ts";

export const title = "Cmd-K, Ask the Space";

const hits = [
  ...LOCAL_HITS,
  { kind: "inbox" as const, id: "ib_lease", title: "Lease documents for Thursday", snippet: "Elena Rivera", link: "vyre://inbox/ib_lease", score: 1 },
];

export default function Mount(): ReactNode {
  const scene = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("scene") ?? "done";
  const no = scene === "noaccess";
  const q = no ? "what is the Zephyr acquisition price" : "what did Elena say about the lease";
  const data = createSampleData({ serverDelayMs: 5, local: hits, ask: () => (scene === "working" ? new Promise(() => undefined) : Promise.resolve(no ? SAMPLE_NO_ACCESS : SAMPLE_ANSWER)) }).data;
  const ctl = useCmdK(data, { revealMs: 0 }, q);
  useEffect(() => { if (scene !== "typing") ctl.choose(); }, [ctl, scene]);
  return (
    <View style={{ flex: 1, backgroundColor: "var(--win)", alignItems: "center", paddingTop: 96 }}>
      <View style={{ width: "100%", maxWidth: 632, paddingHorizontal: 16 }}><CmdKBody controller={ctl} platform="mac" /></View>
    </View>
  );
}
