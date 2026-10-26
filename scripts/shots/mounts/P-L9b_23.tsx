// Mount for P-L9b_23: the Chats place with every leftover screen mounted, over the sample Northwind Space. ?screen= picks what is shown first: agent (?tab= chats, memory, files,
// computer or settings; ?as=owner signs in the agent's owner), helper, needs, popup (the computer popup over the chat), sheet (the recording sheet), connect (Connect an outside
// agent over a channel), agents (the All agents picker), terminal (the terminal beside the chat; ?host=server&locked=1 the locked server shell), terminals (the list), rules (the
// terminal rules) and waiting (a thread that waits on a build). Every control works against the sample replica. The query is read after mount (the static export keeps the first
// frame's markup), so the first frame is empty and the client draws the same one.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { ChatsMounted } from "../../../apps/app/src/places/chats/mounts/ChatsMounted.tsx";
import { CHANNEL, COMPUTER, HELPER, RECORDING, SERVER_TERMINAL, TERMINAL, createMountSample } from "../../../apps/app/src/places/chats/mounts/sample.ts";
import { isTabKey } from "../../../apps/app/src/places/chats/agentpage/model.ts";
import { START, step } from "../../../apps/app/src/places/chats/mounts/route.ts";
import type { Layer, Shown } from "../../../apps/app/src/places/chats/mounts/route.ts";

export const title = "Chats place";

export default function Mount(): ReactNode {
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const params = useMemo(() => new URLSearchParams(search ?? ""), [search]);
  const screen = params.get("screen") ?? "agent";
  const owner = params.get("as") === "owner" || screen === "agent";
  const sample = useMemo(() => {
    const s = createMountSample({ who: owner ? "owner" : "member", asleep: params.get("asleep") === "1" });
    if (screen === "waiting") s.startWait("build 42");
    if (params.get("locked") === "1") s.refuseServer(true);
    return s;
  }, [screen, owner, params]);
  const shown: Shown = useMemo(() => {
    const tab = params.get("tab") ?? "";
    const chat = step(START, { t: "chat", threadId: "c1" });
    const over = (layer: Layer): Shown => step(chat, { t: "layer", layer });
    switch (screen) {
      case "helper": return step(START, { t: "helper", threadId: HELPER });
      case "needs": return step(START, { t: "needs", taskId: "n1" });
      case "popup": return over({ kind: "computer", computerId: COMPUTER, chat: false });
      case "sheet": return over({ kind: "recording", recordingId: RECORDING });
      case "connect": return over({ kind: "connect", channelId: CHANNEL });
      case "agents": return over({ kind: "all-agents", x: 12, y: 160 });
      case "terminal": return step(chat, { t: "terminal", terminalId: params.get("host") === "server" ? SERVER_TERMINAL : TERMINAL });
      case "terminals": return over({ kind: "terminals", x: 300, y: 48 });
      case "rules": return over({ kind: "rules" });
      case "waiting": return chat;
      case "pane": return step(chat, { t: "pane" });
      default: return step(START, { t: "agent", agentId: "agt_intake", tab: isTabKey(tab) ? tab : "chats" });
    }
  }, [screen, params]);
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}><ChatsMounted key={`${screen}:${search}`} rt={sample.rt} initial={shown} window={{ start: 0, end: 500 }} /></View>;
}
