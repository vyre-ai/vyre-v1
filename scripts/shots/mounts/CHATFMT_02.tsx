// Mount for l-chatfmt: a chat with 2,000 messages, for the scroll and typing measurement (scripts/shots/chatfmt-shoot.mjs --perf).
import { useMemo } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { Conversation } from "../../../apps/app/src/places/chats/conversation/Conversation.tsx";
import { createSample } from "../../../apps/app/src/places/chats/conversation/sample.ts";

export const title = "A chat with 2,000 messages";

export default function Mount(): ReactNode {
  const sample = useMemo(() => createSample("huge"), []);
  const height = useWindowDimensions().height;
  return <View style={{ height, backgroundColor: "var(--win)" as string }}><Conversation data={sample.data} /></View>;
}
