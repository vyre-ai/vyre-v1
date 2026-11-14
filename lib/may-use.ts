// One question, asked in one place (F47 audit, 14 Nov 2026): may the person this call acts for use the thing a saved definition names? A watch, a routine and a goal each store ids of agents, computers, chats, channels,
// records and projects; none of them may keep one its saver could not use themselves. Each module raises its own error; the sentence and the level asked are the same everywhere.
// A check that cannot be made (no authorize on the context) refuses.
export interface MayUseCtx {
  authorize?(
    action: { perm: string | null; level: string },
    resource: { type: string; id: string | null },
  ): { effect: string };
}

export type UseKind = "agent" | "computer" | "thread" | "channel" | "record" | "project";

/** What a person sees the thing called, and the level a saved reference to it asks for. */
const KINDS: Readonly<Record<UseKind, { word: string; level: "view" | "use" }>> = {
  agent: { word: "agent", level: "view" },
  computer: { word: "computer", level: "view" },
  thread: { word: "chat", level: "use" },
  channel: { word: "channel", level: "use" },
  record: { word: "record", level: "view" },
  project: { word: "project", level: "view" },
};

/** The refusal in plain words, or null when the person may use it. A "hold" counts as allowed: the Gate holds the same act again when it runs. */
export function cannotUse(ctx: MayUseCtx, kind: UseKind, id: string): string | null {
  const k = KINDS[kind];
  const may =
    typeof ctx.authorize === "function" &&
    ctx.authorize({ perm: null, level: k.level }, { type: kind, id }).effect !== "deny";
  return may ? null : `You cannot use the ${k.word} it names. Pick another, or ask for access to it.`;
}
