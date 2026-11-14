// Mount for CHATFRAME_01 (lane chat-frame): the chat in the real Chats place with the pane of its kind, over the sample Space. ?kind=agent|group|channel|dm picks the pane's tabs; the chat is the busy sample, so
// the head, the composer, the message menu and the "/" list are the real ones.
import { useMemo } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { ChatsPlace } from "../../../apps/app/src/places/chats/ChatsPlace.tsx";
import { NAMES, createSample as createConversationSample } from "../../../apps/app/src/places/chats/conversation/sample.ts";
import { createSample as createPaneSample } from "../../../apps/app/src/places/chats/rightpane/sample.ts";
import { createSampleSidebar, northwind } from "../../../apps/app/src/places/chats/sidebar/sample.ts";
import type { PaneKind } from "../../../apps/app/src/places/chats/rightpane/model.ts";

export const title = "The chat and its pane";

const kindOf = (): PaneKind => {
  const q = new URLSearchParams(globalThis.location?.search ?? "").get("kind");
  return q === "group" || q === "channel" || q === "dm" ? q : "agent";
};

export default function Mount(): ReactNode {
  const height = useWindowDimensions().height;
  const parts = useMemo(() => {
    const conv = createConversationSample("idle", { title: "Client portal launch" });
    const pane = createPaneSample("northwind", { crew: true }).data;
    return {
      sidebar: createSampleSidebar(northwind).data,
      conversation: conv.data,
      pane: { ...pane, me: { id: "usr_irfad" }, nameOf: (id: string) => NAMES[id] ?? id },
    };
  }, []);
  return (
    <View style={{ height, backgroundColor: "var(--win)" as string }}>
      <ChatsPlace
        sidebar={parts.sidebar}
        conversation={parts.conversation}
        pane={parts.pane}
        window={{ start: 0, end: 500 }}
        paneKind={kindOf()}
      />
    </View>
  );
}
