// Ask Vyre from any place (owner rule, rc.17): one door. The agent the person picked, the object the place is about, and optionally the chat they are bringing along and a first message that
// starts a session of its own (Add to Automations). It opens the Ask pane in the place the person pressed it, beside the object (shell/ask/pane.ts); it never navigates to Chats. Only in Chats
// itself, where there is no other place to stay in, does it open the Ask there as before.
import type { ShellRuntime } from "./runtime.tsx";
import { activePlace, openAskPane } from "../ask/pane.ts";

export interface AskAbout { kind: string; id: string; title?: string }

/** Open the Ask pane for `agentId` about an object. `bringFrom` is a chat whose summary the new Ask starts from ("Bring this conversation"); `first` is a ready-made opening message. */
export function openAsk(rt: Pick<ShellRuntime, "open" | "assistant">, agentId: string, about: AskAbout | null, bringFrom?: string, first?: string, extra?: { draft?: string; hint?: string; context?: Parameters<typeof openAskPane>[0]["context"] }): void {
  const place = activePlace();
  if (place !== null && place !== "chats") {
    openAskPane({ thing: about ? { kind: about.kind, id: about.id, ...(about.title ? { title: about.title } : {}) } : null, agentId: agentId === rt.assistant.id ? "assistant" : agentId, ...(bringFrom ? { bringFrom } : {}), ...(first ? { first } : {}), ...(extra?.draft ? { draft: extra.draft } : {}), ...(extra?.hint ? { hint: extra.hint } : {}), ...(extra?.context ? { context: extra.context } : {}) }, place);
    return;
  }
  const who = agentId === "assistant" ? rt.assistant.id : agentId;
  rt.open({ screen: "chats.conversation", args: about ? { with: who, about: `${about.kind}:${about.id}`, ...(bringFrom ? { bring: bringFrom } : {}), ...(first ? { first } : {}), ...(extra?.draft ? { draft: extra.draft } : {}) } : { with: who, ...(first ? { first } : {}) } });
}
