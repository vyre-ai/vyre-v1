// The Kept tab as the pane mounts it (contract with lane chat-frame): `KeptList({ threadId })` is the tab's body and `useKept()` says whether the chat has anything kept, so the pane draws the tab
// only then. Both read the chat's session context (the one provider around the chat and its pane); a press on a row scrolls the chat to the message.
import type { ReactElement } from "react";
import { useSession } from "../../session/context.tsx";
import { KeptTab } from "./KeptTab.tsx";

/** True when the chat has a decision or a kept note. False outside a session context. */
export function useKept(): boolean {
  const s = useSession();
  return s !== null && (s.summary.decisions.length > 0 || s.summary.notes.length > 0);
}

export function KeptList(_: { threadId: string }): ReactElement | null {
  const s = useSession();
  return s ? <KeptTab summary={s.summary} onJump={s.jump} /> : null;
}
