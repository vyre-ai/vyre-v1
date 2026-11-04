// Mount for the chat's "After this" line (lane l-engine21), over the Northwind sample conversation with Intake working. ?part=
//   other  (default) Maya's turn is the one running, you sent a message: it waits, and the line under the thread says "After this: it goes in when this turn ends"
//   own    your own turn is running (the engine takes the message at its next step): the line says "Goes in at the next step"
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Conversation } from "../../../apps/app/src/places/chats/conversation/Conversation.tsx";
import { waiting } from "../../../apps/app/src/places/chats/conversation/waiting-sample.ts";

export const title = "After this";

export default function Mount(): ReactNode {
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const own = new URLSearchParams(search ?? "").get("part") === "own";
  const data = useMemo(() => waiting(own), [own]);
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}><Conversation data={data} /></View>;
}
