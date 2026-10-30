// Ask Vyre from any place (CHAT-DESIGN ruling 3): one door. The agent the person picked, the object the place is about, and optionally the chat they are bringing along. The Chats place turns this
// link into the person's Ask thread on that object with that agent (the newest one, else a new one), so every place asks the same way and the thread keeps its history.
import type { ShellRuntime } from "./runtime.tsx";

export interface AskAbout { kind: string; id: string; title?: string }

/** Open the Ask pane for `agentId` about an object. `bringFrom` is a chat whose summary the new Ask starts from ("Bring this conversation"). */
export function openAsk(rt: Pick<ShellRuntime, "open" | "assistant">, agentId: string, about: AskAbout, bringFrom?: string): void {
  rt.open({ screen: "chats.conversation", args: { with: agentId === "assistant" ? rt.assistant.id : agentId, about: `${about.kind}:${about.id}`, ...(bringFrom ? { bring: bringFrom } : {}) } });
}
