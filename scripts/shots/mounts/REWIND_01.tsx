// Mount for the Rewind card (chat gap G36, G37, lane chat-agents). ?part=
//   points  (default) "Go back to" over three points: the newest picked, what going back undoes and never touches said before the press, and how long points last
//   off     a chat with other people: the card says going back is off
//   none    an agent with no folder: no points, and why
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { RewindCard } from "../../../apps/app/src/places/chats/rewind/RewindCard.tsx";
import { ConversationDataProvider } from "../../../apps/app/src/places/chats/conversation/data.tsx";
import { createSample } from "../../../apps/app/src/places/chats/conversation/sample.ts";

export const title = "Rewind";

const NOW = Date.UTC(2025, 9, 24, 11, 50);
const POINTS = [
  { pointId: "agt_dex.c", agentId: "agt_dex", at: NOW - 8 * 60_000, files: 41, after: "Move the upload form into its own page" },
  { pointId: "agt_dex.b", agentId: "agt_dex", at: NOW - 45 * 60_000, files: 14, after: "Split the sign-in page" },
  { pointId: "agt_dex.a", agentId: "agt_dex", at: NOW - 106 * 60_000, files: 2, after: "Start a client portal" },
];

export default function Mount(): ReactNode {
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const part = new URLSearchParams(search ?? "").get("part") ?? "points";
  const data = useMemo(() => {
    const s = createSample("channel");
    const read =
      part === "off"
        ? { available: false, why: "group", points: [] }
        : part === "none"
          ? { available: true, points: [] }
          : { available: true, points: POINTS };
    return {
      ...s.data,
      call: async (cap: string, input: unknown) =>
        cap === "engine.rewind.points" ? read : s.data.call(cap as never, input as never),
    } as typeof s.data;
  }, [part]);
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return (
    <View style={{ flex: 1, backgroundColor: "var(--win)" as string, padding: 24 }}>
      <ConversationDataProvider value={data}>
        <RewindCard
          threadId="c1"
          onClose={() => undefined}
          clock={(ms) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}
        />
      </ConversationDataProvider>
    </View>
  );
}
