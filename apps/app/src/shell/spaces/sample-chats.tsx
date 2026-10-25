// The real Chats place inside the sample shell: the sidebar, the open chat (Rivera intake with Intake) and Intake's pane, drawn from the sample Spaces of the chats packets. Other places keep
// their sample rows. Used by the shots mount that opens the shell on Chats.
import { useMemo } from "react";
import type { ReactElement, ReactNode } from "react";
import { ChatsPlace } from "../../places/chats/ChatsPlace.tsx";
import { createSample as createConversationSample } from "../../places/chats/conversation/sample.ts";
import { createSample as createPaneSample } from "../../places/chats/rightpane/sample.ts";
import { createSampleSidebar, harbor, northwind } from "../../places/chats/sidebar/sample.ts";
import { homePlace } from "./sample-home.tsx";
import type { PlaceContext } from "./Shell.tsx";

function ChatsBody({ spaceId }: { spaceId: string }): ReactElement {
  const parts = useMemo(() => {
    const team = spaceId === "hb" ? harbor : northwind;
    return { sidebar: createSampleSidebar(team).data, conversation: createConversationSample("idle").data, pane: createPaneSample("northwind").data };
  }, [spaceId]);
  return <ChatsPlace sidebar={parts.sidebar} conversation={parts.conversation} pane={parts.pane} window={{ start: 0, end: 500 }} />;
}

/** renderPlace for the shell: Home and Chats are the real pages, every other place the sample rows. */
export function chatsPlace(ctx: PlaceContext): ReactNode {
  if (ctx.place === "chats") return <ChatsBody key={ctx.spaceId} spaceId={ctx.spaceId} />;
  return homePlace(ctx);
}
