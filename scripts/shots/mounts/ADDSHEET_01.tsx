// Mount for lane l-addsheet (owner, 3 Nov): the one Add people and agents sheet as the app draws it, opened from the chat's header + (a phone: the message box's +), over the sample Northwind chat
// "Rivera intake". The shots script (scripts/shots/addsheet-shoot.mjs) clicks and types to each state, so this mount has no parts of its own.
import { useMemo } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { Conversation } from "../../../apps/app/src/places/chats/conversation/Conversation.tsx";
import { createSample } from "../../../apps/app/src/places/chats/conversation/sample.ts";

export const title = "Add people and agents";

export default function Mount(): ReactNode {
  const sample = useMemo(() => createSample("idle"), []);
  const height = useWindowDimensions().height;
  return <View style={{ height, backgroundColor: "var(--win)" as string }}><Conversation data={sample.data} /></View>;
}
