// Who paid and why, in one plain line for a turn's Details (owner, 3 Nov, the Chat key ruling). Written from the resolver's decision when the turn ends, and read back from the stored turn.
import type { AccountKind, Via } from "./types.ts";

export function payLine(a: { via?: Via; kind: AccountKind; fellBack?: boolean }): string {
  const base = ((): string => {
    switch (a.via) {
      case "chat_key": return "The agent's Chat key";
      case "thread": return "The account picked for this chat";
      case "work": return "The account set for its own work";
      case "step": return "The account chosen for this step";
      case "space": return "A Space AI account";
      case "backup": return "A backup account";
      default: return a.kind === "subscription" ? "The asker's own sign-in" : "The asker's own key";
    }
  })();
  return a.fellBack === true && a.via !== "backup" ? `${base}, after another could not pay` : base;
}
